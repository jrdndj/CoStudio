import 'server-only';
import JSZip from 'jszip';
import sharp from 'sharp';
import type { WorkflowGraph } from '@/lib/study-types';
import { xml } from '@/lib/workflow-svg';
import { db } from './db';
import { getStudyConfig } from './config';
import { renderWorkflow } from './diagrams';
import { dataDictionary } from './research-dictionary';

const chronological: ({ createdAt: 'asc' } | { id: 'asc' })[] = [{ createdAt: 'asc' }, { id: 'asc' }];

export async function researchDataset(id?: string) {
  const participantWhere = id ? { id } : {};
  const where = id ? { participantId: id } : {};
  const [config, configVersions, participants, sessions, events, artefacts, annotations, diary, uploads, workflows, futureProposals, questionnaires] =
    await db.$transaction([
      db.researchConfig.findUnique({ where: { id: 'study' } }),
      db.researchConfigRevision.findMany({ orderBy: { createdAt: 'asc' } }),
      db.participant.findMany({ where: participantWhere, orderBy: chronological }),
      db.studySession.findMany({
        where, orderBy: chronological,
        select: { id: true, participantId: true, createdAt: true, endedAt: true, expiresAt: true },
      }),
      db.researchEvent.findMany({ where, orderBy: { sequence: 'asc' } }),
      db.artefact.findMany({ where, orderBy: chronological }),
      db.annotation.findMany({ where, orderBy: chronological }),
      db.diaryEntry.findMany({ where, orderBy: chronological }),
      db.upload.findMany({ where, orderBy: chronological }),
      db.workflowSnapshot.findMany({ where, orderBy: chronological }),
      db.futureProposal.findMany({ where, orderBy: chronological }),
      db.questionnaireResponse.findMany({ where, orderBy: chronological }),
    ]);
  return {
    config: config ?? await getStudyConfig(), configVersions,
    participants, sessions, events, artefacts, annotations, diary, uploads, workflows, futureProposals, questionnaires,
  };
}

export type ResearchDataset = Awaited<ReturnType<typeof researchDataset>>;
type CsvRow = Record<string, string | number | null>;

const associationFields = ['participantPublicId', 'participantId', 'sessionId', 'artefactId', 'createdAt'];
const eventFields = ['eventId', 'eventSequence', 'eventType', ...associationFields, 'details'];
const questionnaireFields = ['responseId', 'instrumentId', 'version', 'timing', 'activity', ...associationFields, 'itemId', 'value'];

function csvCell(value: CsvRow[string] | undefined) {
  const original = String(value ?? '');
  const safe = /^[\s\u0000-\u001F]*[=+\-@]/.test(original) ? `'${original}` : original;
  return `"${safe.replaceAll('"', '""')}"`;
}

function toCsv(fields: string[], rows: CsvRow[]) {
  return [fields.map(csvCell).join(','), ...rows.map(row => fields.map(field => csvCell(row[field])).join(','))].join('\r\n') + '\r\n';
}

export function csvExports(dataset: ResearchDataset) {
  const publicIds = new Map(dataset.participants.map(row => [row.id, row.publicId]));
  function association(row: { participantId: string; sessionId: string; artefactId: string | null; createdAt: Date }) {
    return {
      participantPublicId: publicIds.get(row.participantId) ?? '',
      participantId: row.participantId,
      sessionId: row.sessionId,
      artefactId: row.artefactId,
      createdAt: row.createdAt.toISOString(),
    };
  }
  const events = dataset.events.map(row => ({
    eventId: row.id, eventSequence: row.sequence, eventType: row.type, details: JSON.stringify(row.data), ...association(row),
  }));
  const questionnaires = dataset.questionnaires.flatMap(row => {
    const answers = row.responses;
    if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return [];
    return Object.entries(answers).map(([itemId, value]) => ({
      responseId: row.id,
      instrumentId: row.instrumentId,
      version: row.version,
      timing: row.timing,
      activity: row.activity,
      itemId,
      value: JSON.stringify(value),
      ...association(row),
    }));
  });
  const combined: CsvRow[] = [
    ...events.map(row => ({ recordType: 'event', ...row })),
    ...questionnaires.map(row => ({ recordType: 'questionnaireItem', ...row })),
  ];
  combined.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  return {
    combined: toCsv(['recordType', ...new Set([...eventFields, ...questionnaireFields])], combined),
    events: toCsv(eventFields, events),
    questionnaires: toCsv(questionnaireFields, questionnaires),
  };
}

const imageExtensions: Record<string, string> = { png: 'png', jpeg: 'jpg', webp: 'webp', gif: 'gif', 'svg+xml': 'svg' };

export function exportImage(value?: string | null) {
  const match = value?.match(/^data:image\/(png|jpeg|webp|gif|svg\+xml);base64,([A-Za-z0-9+/=]+)$/);
  return match ? { extension: imageExtensions[match[1]], bytes: Buffer.from(match[2], 'base64') } : null;
}

export function imageSvg(dataUrl: string, title: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000" viewBox="0 0 1600 1000" role="img"><title>${xml(title)}</title><image href="${xml(dataUrl)}" width="1600" height="1000" preserveAspectRatio="xMidYMid meet"/></svg>`;
}

export function eventJsonl(dataset: ResearchDataset) {
  return dataset.events.map(event => JSON.stringify(event)).join('\n') + (dataset.events.length ? '\n' : '');
}

export function exportEnvelope(dataset: ResearchDataset, participantScope: string | undefined) {
  return { schemaVersion: '1.0', exportedAt: new Date().toISOString(), participantScope: participantScope ?? null, dataset, dataDictionary };
}

export async function archiveResearch(dataset: ResearchDataset, participantScope?: string) {
  const zip = new JSZip();
  zip.file('research.json', JSON.stringify(exportEnvelope(dataset, participantScope), null, 2));
  zip.file('data-dictionary.json', JSON.stringify(dataDictionary, null, 2));
  zip.file('events.jsonl', eventJsonl(dataset));
  const csv = csvExports(dataset);
  zip.file('activity.csv', csv.combined);
  zip.file('events.csv', csv.events);
  zip.file('questionnaire-items.csv', csv.questionnaires);

  for (const artefact of dataset.artefacts) {
    const base = `participants/${artefact.participantId}/artefacts/${artefact.id}`;
    zip.file(`${base}.json`, JSON.stringify({
      ...artefact, annotations: dataset.annotations.filter(item => item.artefactId === artefact.id),
    }, null, 2));
    const image = exportImage(artefact.imageUrl);
    if (image) zip.file(`${base}.${image.extension}`, image.bytes);
    if (artefact.workflow) {
      const graph = artefact.workflow as unknown as WorkflowGraph;
      const workflow = await renderWorkflow(artefact.title, graph);
      zip.file(`${base}.svg`, workflow.svg);
      const png = exportImage(workflow.png);
      if (png) zip.file(`${base}.png`, png.bytes);
    }
  }
  for (const upload of dataset.uploads) {
    const base = `participants/${upload.participantId}/uploads/${upload.id}`;
    const image = exportImage(upload.dataUrl);
    if (!image) continue;
    zip.file(`${base}.${image.extension}`, image.bytes);
    if (image.extension !== 'svg') zip.file(`${base}.svg`, imageSvg(upload.dataUrl, upload.name));
    if (image.extension !== 'png') zip.file(`${base}.png`, await sharp(image.bytes).png().toBuffer());
  }
  for (const workflow of dataset.workflows) {
    const base = `participants/${workflow.participantId}/workflows/${workflow.id}`;
    const graph = { nodes: workflow.nodes, edges: workflow.edges } as unknown as WorkflowGraph;
    const snapshot = workflow.svg && workflow.png ? workflow : await renderWorkflow(workflow.title, graph);
    if (snapshot.svg) zip.file(`${base}.svg`, snapshot.svg);
    const png = exportImage(snapshot.png);
    if (png) zip.file(`${base}.png`, png.bytes);
  }
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
