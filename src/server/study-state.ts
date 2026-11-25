import type { Artefact, StudyState, Upload } from "@/lib/study-types";
import type { Prisma } from "@prisma/client";
import { backendMode, consentReady, profileFields, type StudyConfig } from "./config";
import { db } from "./db";
import { maxImageBytes } from "./security";
import type { ParticipantSession } from "./session";

type ArtefactRow = Prisma.ArtefactGetPayload<{ include: { annotations: true } }>;
type UploadRow = Prisma.UploadGetPayload<{}>;

function mediaUrl(kind: string, id: string) {
  return `/api/study/media/${kind}/${encodeURIComponent(id)}`;
}

export function artefactView(row: ArtefactRow): Artefact {
  return {
    id: row.id,
    title: row.title,
    text: row.text,
    imageUrl: row.imageUrl ? mediaUrl("artefact", row.id) : null,
    outputType: row.outputType as Artefact["outputType"],
    origin: row.origin as Artefact["origin"],
    backend: row.backend as Artefact["backend"],
    status: row.status as Artefact["status"],
    parentId: row.parentId,
    decision: row.decision as Artefact["decision"],
    reflection: row.reflection,
    annotations: row.annotations.map(({ id, text, createdAt }) => ({ id, text, createdAt: createdAt.toISOString() })),
    workflow: row.workflow as unknown as Artefact["workflow"],
    prompt: row.prompt,
    promptSource: row.promptSource as Artefact["promptSource"],
    mode: row.mode as Artefact["mode"],
    createdAt: row.createdAt.toISOString(),
  };
}

export function uploadView(row: UploadRow): Upload {
  return { id: row.id, name: row.name, dataUrl: mediaUrl("upload", row.id), purpose: row.purpose as Upload["purpose"], createdAt: row.createdAt.toISOString() };
}

export function hasCurrentConsent(participant: ParticipantSession["participant"], config: StudyConfig) {
  return Boolean(participant.consentAt && participant.consentVersion === config.consentVersion && consentReady(config));
}

export async function loadState(config: StudyConfig, session: ParticipantSession | null): Promise<StudyState> {
  const state: StudyState = {
    participant: null,
    session: null,
    settings: {
      backend: backendMode(),
      consentText: config.consentText,
      consentVersion: config.consentVersion,
      consentReady: consentReady(config),
      configVersion: config.configVersion,
      allowedModes: config.allowedModes,
      suggestions: config.suggestions,
      maxImageBytes: maxImageBytes(),
      profileFields: profileFields(),
    },
    artefacts: [],
    diary: [],
    uploads: [],
    workflows: [],
    questionnaires: [],
    responses: [],
    future: null,
    events: [],
  };
  if (!session) return state;
  const participant = await db.participant.findUnique({ where: { id: session.participantId } });
  if (!participant) return state;

  const signed = hasCurrentConsent(participant, config);
  state.participant = {
    id: participant.id,
    publicId: participant.publicId,
    consentAt: signed ? participant.consentAt!.toISOString() : null,
    consentVersion: participant.consentVersion,
    role: participant.role as NonNullable<StudyState["participant"]>["role"],
    roles: participant.roles as NonNullable<StudyState["participant"]>["roles"],
    experience: participant.experience,
    genres: participant.genres,
    status: participant.status,
    tools: participant.tools,
    aiExperience: participant.aiExperience,
    activeRole: participant.activeRole as NonNullable<StudyState["participant"]>["activeRole"],
    stage: participant.stage as NonNullable<StudyState["participant"]>["stage"],
    mode: config.allowedModes.includes(participant.mode as never) ? participant.mode as NonNullable<StudyState["participant"]>["mode"] : "",
  };
  state.session = { id: session.id, createdAt: session.createdAt.toISOString(), expiresAt: session.expiresAt.toISOString() };
  if (!signed) return state;

  const where = { participantId: session.participantId };
  const newest = [{ createdAt: "desc" as const }, { id: "desc" as const }];
  const [artefacts, diary, uploads, workflows, responses, future, events] = await Promise.all([
    db.artefact.findMany({ where, orderBy: newest, include: { annotations: { orderBy: { createdAt: "asc" } } } }),
    db.diaryEntry.findMany({ where, orderBy: newest }),
    db.upload.findMany({ where, orderBy: newest }),
    db.workflowSnapshot.findMany({ where, orderBy: newest }),
    db.questionnaireResponse.findMany({ where, orderBy: newest }),
    db.futureProposal.findUnique({ where }),
    db.researchEvent.findMany({ where, orderBy: { sequence: "desc" }, take: 180 }),
  ]);
  state.artefacts = artefacts.map(artefactView);
  state.diary = diary.map((row) => ({
    ...row,
    answers: row.answers as unknown as StudyState["diary"][number]["answers"],
    createdAt: row.createdAt.toISOString(),
  }));
  state.uploads = uploads.map(uploadView);
  state.workflows = workflows.map((row) => ({
    id: row.id, title: row.title, nodes: row.nodes as unknown as StudyState["workflows"][number]["nodes"],
    edges: row.edges as unknown as StudyState["workflows"][number]["edges"],
    svg: row.svg ? mediaUrl("svg", row.id) : null,
    png: row.png ? mediaUrl("png", row.id) : null,
    createdAt: row.createdAt.toISOString(),
  }));
  state.questionnaires = config.questionnaires;
  state.responses = responses.map((row) => ({
    ...row,
    timing: row.timing as StudyState["responses"][number]["timing"],
    responses: row.responses as StudyState["responses"][number]["responses"],
    createdAt: row.createdAt.toISOString(),
  }));
  state.future = future ? { ...future, createdAt: future.createdAt.toISOString(), updatedAt: future.updatedAt.toISOString() } : null;
  state.events = events.map((row) => ({
    sequence: row.sequence, id: row.id, type: row.type, data: row.data as StudyState["events"][number]["data"],
    artefactId: row.artefactId, sessionId: row.sessionId, createdAt: row.createdAt.toISOString(),
  }));
  return state;
}
