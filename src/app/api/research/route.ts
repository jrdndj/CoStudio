import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { db } from '@/server/db';
import { backendMode, consentReady, getStudyConfig, type StudyConfig } from '@/server/config';
import { hashStudyCode, maxImageBytes, StudyError, validateImageData } from '@/server/security';
import { diagramSchema } from '@/server/validation';
import { researcherSignedIn, signInResearcher, signOutResearcher } from '@/server/research-auth';
import { asRecord, parseResearchConfig } from '@/server/research-config';
import { archiveResearch, csvExports, eventJsonl, exportEnvelope, researchDataset } from '@/server/research-data';
import { dataDictionary } from '@/server/research-dictionary';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const noStore = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: noStore });
const error = (message: string, status: number) => json({ error: message }, status);

function reportFailure(message: string, cause: unknown) {
  const code = cause instanceof Error && 'code' in cause && typeof cause.code === 'string' ? cause.code : undefined;
  console.error(message, cause instanceof Error ? cause.name : 'Unknown error', code ?? '');
}
async function overview() {
  const [config, codes, participants, wizard] = await Promise.all([
    getStudyConfig(),
    db.studyCode.findMany({
      orderBy: { createdAt: 'desc' },
      select: { id: true, createdAt: true, expiresAt: true, participant: { select: { publicId: true } } },
    }),
    db.participant.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, publicId: true, role: true, mode: true, stage: true, createdAt: true, consentAt: true,
        _count: { select: { sessions: true, events: true, artefacts: true, diary: true, workflows: true, questionnaires: true } },
        future: { select: { finalized: true } },
      },
    }),
    db.artefact.findMany({
      where: { backend: 'WIZARD', status: 'pending' }, orderBy: { createdAt: 'asc' },
      select: {
        id: true, title: true, prompt: true, parentId: true, outputType: true, mode: true, createdAt: true,
        participant: { select: { publicId: true } },
      },
    }),
  ]);
  return {
    config, consentReady: consentReady(config), backend: backendMode(), codes, wizard,
    participants: participants.map(participant => ({
      ...participant,
      pictorialId: `P-${createHash('sha256').update(`costudio-pictorial:${participant.id}`).digest('hex').slice(0, 8).toUpperCase()}`,
    })),
  };
}

function acceptedOrigin(request: NextRequest) {
  const source = request.headers.get('sec-fetch-site');
  if (source && source !== 'same-origin' && source !== 'none') return false;
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try {
    const originHost = new URL(origin).host;
    return originHost === request.nextUrl.host || originHost === request.headers.get('host');
  } catch {
    return false;
  }
}

async function readBody(request: NextRequest) {
  const limit = Math.max(4_000_000, Math.ceil(maxImageBytes() * 4 / 3) + 120_000);
  if (!request.body || Number(request.headers.get('content-length')) > limit) throw new StudyError('Request is too large or empty.', 413);
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let body = '';
  let bytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > limit) {
        await reader.cancel();
        throw new StudyError('Request is too large.', 413);
      }
      body += decoder.decode(chunk.value, { stream: true });
    }
    return asRecord(JSON.parse(body + decoder.decode()));
  } catch (cause) {
    if (cause instanceof StudyError) throw cause;
    throw new StudyError('Send a valid JSON object.');
  } finally {
    reader.releaseLock();
  }
}

function checkedId(value: unknown) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(value)) throw new StudyError('Invalid study record ID.');
  return value;
}

function instrumentSpecification(instrument: {
  timing: string; items: { id: string; type: string; label: string; required?: boolean; min?: number; max?: number; step?: number; options?: string[] }[];
}) {
  return JSON.stringify({
    timing: instrument.timing,
    items: instrument.items.map(item => ({
      id: item.id, type: item.type, label: item.label, required: item.required !== false,
      min: item.min ?? null, max: item.max ?? null, step: item.step ?? null, options: item.options ?? [],
    })),
  });
}

async function fulfillWizard(body: Record<string, unknown>) {
  const id = checkedId(body.id);
  const pending = await db.artefact.findFirst({ where: { id, backend: 'WIZARD', status: 'pending' } });
  if (!pending) throw new StudyError('This request has already been resolved or withdrawn.', 404);
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!title || title.length > 150 || text.length > 25000) throw new StudyError('Enter a title of up to 150 characters and text of up to 25,000 characters.');
  if (pending.outputType === 'text' && !text) throw new StudyError('Add response text.');
  const workflow = pending.outputType === 'workflow' ? diagramSchema.safeParse(body.workflow) : null;
  if (workflow && !workflow.success) throw new StudyError(workflow.error.issues[0]?.message || 'Enter a valid workflow graph.');
  const visual = ['storyboard', 'moodboard', 'concept'].includes(pending.outputType);
  if (visual && typeof body.image !== 'string') throw new StudyError('Attach a PNG, JPEG or WebP image.');
  const imageUrl = visual && typeof body.image === 'string' ? await validateImageData(body.image) : null;
  const existingParameters = pending.parameters && typeof pending.parameters === 'object' && !Array.isArray(pending.parameters)
    ? pending.parameters : {};
  await db.$transaction(async transaction => {
    const saved = await transaction.artefact.updateMany({
      where: { id, status: 'pending', backend: 'WIZARD' },
      data: {
        title, text, status: 'completed', origin: 'human', imageUrl,
        parameters: { ...existingParameters, suppliedBy: 'researcher' } as Prisma.InputJsonObject,
        response: { title, text, suppliedBy: 'researcher', ...(workflow ? { workflow: workflow.data } : {}) },
        ...(workflow ? { workflow: workflow.data } : {}),
      },
    });
    if (saved.count !== 1) throw new StudyError('This request has already been resolved or withdrawn.', 409);
    await transaction.researchEvent.create({
      data: {
        id: randomUUID(), participantId: pending.participantId, sessionId: pending.sessionId, artefactId: id,
        type: 'GENERATION_COMPLETED', data: { backend: 'WIZARD', suppliedBy: 'researcher' },
      },
    });
  });
}

export async function POST(request: NextRequest) {
  if (!acceptedOrigin(request)) return error('This request must come from CoStudio.', 403);
  if (!request.headers.get('content-type')?.startsWith('application/json')) return error('Send JSON.', 415);

  try {
    const body = await readBody(request);
    if (body.action === 'login') {
      const secure = request.nextUrl.protocol === 'https:' || process.env.COOKIE_SECURE === 'true';
      const result = await signInResearcher(body.password, secure);
      if (result === 'unconfigured') return error('Researcher access requires a configured RESEARCHER_PASSWORD.', 503);
      if (result === 'limited') return error('Too many attempts. Try again in 15 minutes.', 429);
      if (result === 'invalid') return error('The researcher password is incorrect.', 401);
      return json({ signedIn: true });
    }
    if (!await researcherSignedIn()) return error('Sign in as a researcher.', 401);
    switch (body.action) {
      case 'logout':
        await signOutResearcher();
        return json({ signedIn: false });
      case 'overview':
        return json(await overview());
      case 'participant': {
        const data = await researchDataset(checkedId(body.id));
        return data.participants.length ? json(data) : error('Participant does not exist.', 404);
      }
      case 'createCode': {
        const code = typeof body.code === 'string' && body.code.trim()
          ? body.code.trim().toUpperCase() : `CS-${randomBytes(18).toString('hex').toUpperCase()}`;
        if (!/^[A-Z0-9-]{8,64}$/.test(code)) return error('Use 8–64 letters, digits or hyphens for a study code.', 400);
        const days = body.expiresInDays;
        if (days !== null && days !== undefined && (typeof days !== 'number' || !Number.isInteger(days) || days < 1 || days > 365)) {
          return error('Choose 1–365 days to expiration or leave it blank.', 400);
        }
        const codeHash = hashStudyCode(code);
        if (await db.studyCode.findUnique({ where: { codeHash } })) return error('This study code already exists.', 409);
        const row = await db.studyCode.create({
          data: { codeHash, expiresAt: typeof days === 'number' ? new Date(Date.now() + days * 86400000) : null },
          select: { id: true, expiresAt: true },
        });
        return json({ ...row, code }, 201);
      }
      case 'saveConfig': {
        let parsed;
        try { parsed = parseResearchConfig(body.config); }
        catch (cause) { throw new StudyError(cause instanceof Error ? cause.message : 'Invalid study settings.'); }
        const current = await getStudyConfig();
        if (body.expectedConfigVersion !== current.configVersion) {
          throw new StudyError('Study settings changed since this page was opened. Reload before saving.', 409);
        }
        const revisions = await db.researchConfigRevision.findMany({ select: { snapshot: true } });
        const history = [current, ...revisions.map(revision => revision.snapshot as unknown as StudyConfig)];
        if (history.some(config => parsed.consentText !== config.consentText && parsed.consentVersion === config.consentVersion)) {
          throw new StudyError('Assign a new consent version when changing consent text.');
        }
        for (const instrument of parsed.questionnaires) {
          const previous = history.flatMap(config => config.questionnaires).find(item => item.id === instrument.id && item.version === instrument.version);
          if (previous && instrumentSpecification(previous) !== instrumentSpecification(instrument)) {
            throw new StudyError(`Assign a new instrument version when changing ${instrument.name} items or timing.`);
          }
        }
        const record = { ...parsed, configVersion: randomUUID() };
        await db.$transaction(async transaction => {
          if (current.configVersion === 'builtin-1') {
            try { await transaction.researchConfig.create({ data: { id: 'study', ...record } }); }
            catch (cause) {
              if (cause instanceof Error && 'code' in cause && cause.code === 'P2002') {
                throw new StudyError('Study settings changed since this page was opened. Reload before saving.', 409);
              }
              throw cause;
            }
          } else {
            const saved = await transaction.researchConfig.updateMany({ where: { id: 'study', configVersion: current.configVersion }, data: record });
            if (!saved.count) throw new StudyError('Study settings changed since this page was opened. Reload before saving.', 409);
          }
          await transaction.researchConfigRevision.upsert({
            where: { version: current.configVersion },
            create: {
              version: current.configVersion,
              snapshot: {
                ...current,
                updatedAt: current.updatedAt.toISOString(),
                suggestions: current.suggestions.map(item => ({ ...item })),
                questionnaires: current.questionnaires.map(item => ({ ...item, items: item.items.map(question => ({ ...question })) })),
              },
            },
            update: {},
          });
          await transaction.researchConfigRevision.create({
            data: { version: record.configVersion, snapshot: { id: 'study', ...record } },
          });
        });
        const config = await getStudyConfig();
        return json({ config, consentReady: consentReady(config) });
      }
      case 'deleteParticipant': {
        const id = checkedId(body.id);
        await db.$transaction(async transaction => {
          const participant = await transaction.participant.findUnique({ where: { id } });
          if (!participant) throw new StudyError('Participant does not exist.', 404);
          if (body.confirmation !== participant.publicId || body.protocolConfirmed !== true) {
            throw new StudyError('Confirm the protocol and enter the participant ID exactly.');
          }
          await transaction.participant.delete({ where: { id } });
          await transaction.studyCode.delete({ where: { id: participant.codeId } });
        });
        return json({ deleted: id });
      }
      case 'fulfillWizard':
        await fulfillWizard(body);
        return json({ resolved: body.id });
      default:
        return error('Unknown researcher action.', 400);
    }
  } catch (cause) {
    if (cause instanceof StudyError) return error(cause.message, cause.status);
    if (cause instanceof Error && 'code' in cause && cause.code === 'P2002') return error('This record already exists.', 409);
    reportFailure('CoStudio researcher operation failed.', cause);
    return error('CoStudio could not complete the researcher operation.', 500);
  }
}

export async function GET(request: NextRequest) {
  if (!await researcherSignedIn()) return error('Sign in as a researcher.', 401);
  const params = request.nextUrl.searchParams;
  const format = params.get('format') ?? '';
  const formats = ['json', 'jsonl', 'csv', 'events', 'questionnaires', 'zip', 'dictionary'];
  if (!formats.includes(format)) return error('Select an export format.', 400);

  try {
    const id = params.has('participant') ? checkedId(params.get('participant')) : undefined;
    const scope = id ? `participant-${id}` : 'study';
    const fileBase = `costudio-${scope}`;
    const download = (name: string, type: string, data: BodyInit) => new Response(data, {
      headers: { ...noStore, 'Content-Type': type, 'Content-Disposition': `attachment; filename="${name}"` },
    });
    if (format === 'dictionary') {
      return download('costudio-data-dictionary.json', 'application/json; charset=utf-8', JSON.stringify(dataDictionary, null, 2));
    }
    const dataset = await researchDataset(id);
    if (id && dataset.participants.length === 0) return error('Participant does not exist.', 404);
    if (format === 'json') {
      return download(`${fileBase}.json`, 'application/json; charset=utf-8', JSON.stringify(exportEnvelope(dataset, id), null, 2));
    }
    if (format === 'jsonl') return download(`${fileBase}-events.jsonl`, 'application/x-ndjson; charset=utf-8', eventJsonl(dataset));
    if (format === 'zip') {
      const bytes = await archiveResearch(dataset, id);
      return download(`${fileBase}.zip`, 'application/zip', new Uint8Array(bytes).buffer);
    }
    const csv = csvExports(dataset);
    const records = format === 'events' ? 'events' : format === 'questionnaires' ? 'questionnaires' : 'combined';
    return download(`${fileBase}-${records}.csv`, 'text/csv; charset=utf-8', csv[records]);
  } catch (cause) {
    if (cause instanceof StudyError) return error(cause.message, cause.status);
    reportFailure('CoStudio research export failed.', cause);
    return error('CoStudio could not prepare the export.', 500);
  }
}
