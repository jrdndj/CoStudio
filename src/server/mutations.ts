import type { Prisma } from "@prisma/client";
import type { FutureProposal, PromptSource } from "@/lib/study-types";
import { consentReady, integerEnv, profileFields, type StudyConfig } from "./config";
import { db } from "./db";
import { renderWorkflow } from "./diagrams";
import { stableHash, StudyError, validateImageData } from "./security";
import { recordEvent, researchEventId, type ParticipantSession } from "./session";
import { artefactView, uploadView } from "./study-state";
import { diagramSchema, validateResponses, type StudyAction } from "./validation";

export function mutationKey(session: ParticipantSession, action: string, eventId: string) {
  return stableHash(`mutation:${session.id}:${action}:${eventId}`);
}

export async function ownedArtefact(tx: Prisma.TransactionClient, participantId: string, id: string) {
  const result = await tx.artefact.findFirst({ where: { id, participantId } });
  if (!result) throw new StudyError("Artefact not found.", 404);
  return result;
}

export async function ownedUpload(tx: Prisma.TransactionClient, participantId: string, id: string) {
  const result = await tx.upload.findFirst({ where: { id, participantId } });
  if (!result) throw new StudyError("Attachment not found.", 404);
  return result;
}

export function promptOrigin(config: StudyConfig, prompt: string, claimed: PromptSource, id?: string) {
  if (!id) {
    if (claimed !== "original") throw new StudyError("A suggested prompt requires the original suggestion identifier.");
    return { source: claimed };
  }
  const suggestion = config.suggestions.find((item) => item.id === id);
  if (!suggestion) throw new StudyError("That suggested prompt is no longer available. Reload this workspace to continue.", 409);
  return { source: suggestion.text.trim() === prompt ? "suggested" as const : "modified" as const, suggestion };
}

const decisionEvents = {
  accept: "ARTEFACT_ACCEPTED", adapt: "ARTEFACT_ADAPTED", reject: "ARTEFACT_REJECTED",
  alternatives: "ALTERNATIVES_REQUESTED", save: "ARTEFACT_SAVED",
};
const mutationReplies = ["upload", "decision"] as const;
type MutationReply = typeof mutationReplies[number];
type OrdinaryAction = Exclude<StudyAction, { action: "state" | "redeem" | "generate" | "logout" }>;

async function getStoredResult(action: MutationReply, participantId: string, resultId: string) {
  if (action === "upload") {
    const upload = await db.upload.findFirst({ where: { id: resultId, participantId } });
    return upload ? { upload: uploadView(upload) } : {};
  }
  const artefact = await db.artefact.findFirst({ where: { id: resultId, participantId }, include: { annotations: true } });
  return artefact ? { artefact: artefactView(artefact) } : {};
}

export async function mutate(action: OrdinaryAction, config: StudyConfig, session: ParticipantSession, key: string) {
  const existing = await db.studyMutation.findUnique({ where: { id: key } });
  if (existing) {
    return existing.resultId && (action.action === "upload" || action.action === "decision")
      ? getStoredResult(action.action, session.participantId, existing.resultId) : {};
  }

  let graph: ReturnType<typeof diagramSchema.parse> | undefined;
  let exports: Awaited<ReturnType<typeof renderWorkflow>> | undefined;
  let dataUrl: string | undefined;
  if (action.action === "workflow") {
    const parsed = diagramSchema.safeParse({ nodes: action.nodes, edges: action.edges });
    if (!parsed.success) throw new StudyError(parsed.error.issues[0]?.message || "The workflow map is invalid.");
    graph = parsed.data;
    exports = await renderWorkflow(action.title, graph);
  } else if (action.action === "upload") {
    dataUrl = await validateImageData(action.dataUrl);
  }

  let result: string | undefined;
  try {
    result = await db.$transaction(async (tx) => {
      const { participantId, id: sessionId } = session;
      const actor = { participantId, sessionId };
      const createdAt = new Date();
      await tx.studyMutation.create({ data: { ...actor, id: key, action: action.action } });
      const event = (type: string, data: Prisma.InputJsonObject = {}, artefactId?: string) =>
        recordEvent(tx, session, researchEventId(key, type), type, data, artefactId);
      const participant = await tx.participant.findUniqueOrThrow({ where: { id: participantId } });
      let resultId: string | undefined;

      switch (action.action) {
        case "consent": {
          if (!consentReady(config)) throw new StudyError("The research team has yet to configure approved consent material.", 409);
          if (action.version && action.version !== config.consentVersion) {
            throw new StudyError("Consent information has changed. Reload this page before continuing.", 409);
          }
          if (!participant.consentAt || participant.consentVersion !== config.consentVersion) {
            await tx.participant.update({ where: { id: participantId }, data: { consentAt: new Date(), consentVersion: config.consentVersion } });
            await event("CONSENT_RECORDED", { consentVersion: config.consentVersion, configVersion: config.configVersion });
          }
          break;
        }
        case "profile": {
          const fields = profileFields();
          const roles = [...new Set([action.role, ...(fields.includes("roles") ? action.roles : [])])];
          const activeRole = participant.activeRole && roles.includes(participant.activeRole as typeof action.role) ? participant.activeRole : action.role;
          await tx.participant.update({
            where: { id: participantId },
            data: {
              role: action.role, roles, activeRole,
              experience: fields.includes("experience") ? action.experience ?? null : undefined,
              genres: fields.includes("genres") ? action.genres || null : undefined,
              status: fields.includes("status") ? action.status || null : undefined,
              tools: fields.includes("tools") ? action.tools || null : undefined,
              aiExperience: fields.includes("aiExperience") ? action.aiExperience || null : undefined,
            },
          });
          await event("PROFILE_SAVED", { primaryRole: action.role, roles });
          if (participant.activeRole !== activeRole) await event("ROLE_SELECTED", { from: participant.activeRole, to: activeRole });
          break;
        }
        case "select": {
          const patch: Prisma.ParticipantUpdateInput = {};
          const roles = participant.roles as string[];
          if (action.role && action.role !== participant.activeRole) {
            if (!roles.includes(action.role)) throw new StudyError("Select a role in your participant profile.");
            patch.activeRole = action.role;
            await event("ROLE_SELECTED", { from: participant.activeRole, to: action.role });
          }
          if (action.stage && action.stage !== participant.stage) {
            patch.stage = action.stage;
            await event("CREATIVE_STAGE_SELECTED", { from: participant.stage, to: action.stage });
          }
          if (action.mode && action.mode !== participant.mode) {
            if (!config.allowedModes.includes(action.mode)) throw new StudyError("That collaboration mode is unavailable.");
            patch.mode = action.mode;
            await event("MODE_CHANGED", { from: participant.mode || null, to: action.mode, configVersion: config.configVersion });
          }
          if (Object.keys(patch).length) await tx.participant.update({ where: { id: participantId }, data: patch });
          break;
        }
        case "prompt": {
          const suggestion = config.suggestions.find((item) => item.id === action.suggestionId);
          await event(action.kind === "selected" ? "PROMPT_SELECTED" : "PROMPT_EDITED", {
            text: action.text, suggestionId: action.suggestionId ?? null, suggestedText: suggestion?.text ?? null,
            role: participant.activeRole, stage: participant.stage, configVersion: config.configVersion,
          });
          break;
        }
        case "decision": {
          const artefact = await ownedArtefact(tx, participantId, action.artefactId);
          if (artefact.status !== "completed") throw new StudyError("This artefact is not ready for participant decisions.", 409);
          await tx.artefact.update({ where: { id: artefact.id }, data: {
            decision: action.decision,
            ...(action.reflection !== undefined ? { reflection: action.reflection || null } : {}),
          } });
          const hasEdit = action.title !== undefined || action.text !== undefined || Boolean(action.workflow);
          if (action.decision === "adapt" && hasEdit) {
            const revised = await tx.artefact.create({
              data: {
                ...actor, createdAt, parentId: artefact.id, title: action.title || artefact.title, text: action.text ?? artefact.text,
                outputType: artefact.outputType, origin: "human", backend: "MANUAL", status: "completed",
                prompt: "", promptSource: "original", mode: participant.mode, imageUrl: artefact.imageUrl,
                parameters: { parentOutputType: artefact.outputType, copyPriorImage: Boolean(artefact.imageUrl) },
                response: { edit: "participant", title: action.title ?? null, text: action.text ?? null },
                workflow: action.workflow ?? (artefact.workflow as Prisma.InputJsonValue | null) ?? undefined,
              },
            });
            resultId = revised.id;
          }
          await event(decisionEvents[action.decision], { reflection: action.reflection ?? null, revisionId: resultId ?? null }, artefact.id);
          break;
        }
        case "annotate": {
          const artefact = await ownedArtefact(tx, participantId, action.artefactId);
          const annotation = await tx.annotation.create({ data: { ...actor, createdAt, artefactId: artefact.id, text: action.text } });
          await event("ANNOTATION_CREATED", { annotationId: annotation.id, text: action.text }, artefact.id);
          break;
        }
        case "view": {
          const artefact = await ownedArtefact(tx, participantId, action.artefactId);
          await event("ARTEFACT_VIEWED", { outputType: artefact.outputType, origin: artefact.origin, status: artefact.status }, artefact.id);
          break;
        }
        case "upload": {
          if (!dataUrl) throw new StudyError("No usable image was uploaded.");
          const count = await tx.upload.count({ where: { participantId } });
          if (count >= integerEnv("PARTICIPANT_UPLOAD_LIMIT", 80, 1, 10000)) throw new StudyError("The study upload limit was reached.", 429);
          const name = action.name.replace(/[\\/]/g, "_").replace(/[\u0000-\u001f]/g, "") || "sketch";
          const upload = await tx.upload.create({ data: { ...actor, createdAt, dataUrl, name, purpose: action.purpose } });
          resultId = upload.id;
          await event("SKETCH_UPLOADED", { uploadId: upload.id, name, purpose: action.purpose });
          break;
        }
        case "diary": {
          if (action.artefactId) await ownedArtefact(tx, participantId, action.artefactId);
          if (action.attachmentId) await ownedUpload(tx, participantId, action.attachmentId);
          const entry = await tx.diaryEntry.create({ data: {
            ...actor, createdAt, artefactId: action.artefactId, attachmentId: action.attachmentId, answers: action.answers,
          } });
          await event("DIARY_SUBMITTED", { entryId: entry.id, attachmentId: entry.attachmentId, usedAI: action.answers.usedAI }, entry.artefactId ?? undefined);
          break;
        }
        case "workflow": {
          if (!graph || !exports) throw new StudyError("The workflow could not be saved.");
          const snapshot = await tx.workflowSnapshot.create({ data: {
            ...actor, createdAt, title: action.title, nodes: graph.nodes, edges: graph.edges, ...exports,
          } });
          await event("WORKFLOW_UPDATED", { snapshotId: snapshot.id, nodeCount: graph.nodes.length, edgeCount: graph.edges.length, origin: "human" });
          break;
        }
        case "future": {
          if (action.sketchId) await ownedUpload(tx, participantId, action.sketchId);
          if (action.artefactId) await ownedArtefact(tx, participantId, action.artefactId);
          const fields: Pick<FutureProposal, "description" | "acceptable" | "unacceptable" | "sketchId" | "artefactId" | "finalized"> = {
            description: action.description, acceptable: action.acceptable, unacceptable: action.unacceptable,
            sketchId: action.sketchId ?? null, artefactId: action.artefactId ?? null, finalized: action.finalized,
          };
          const proposal = await tx.futureProposal.upsert({
            where: { participantId },
            create: { ...actor, createdAt, ...fields },
            update: { sessionId, ...fields },
          });
          await event(action.finalized ? "FUTURE_PROPOSAL_FINALIZED" : "FUTURE_PROPOSAL_UPDATED",
            { proposalId: proposal.id, ...fields }, proposal.artefactId ?? undefined);
          break;
        }
        case "questionnaire": {
          if (action.artefactId) await ownedArtefact(tx, participantId, action.artefactId);
          const questionnaire = config.questionnaires.find((question) => question.id === action.instrumentId && question.version === action.version);
          if (!questionnaire || !questionnaire.items.length) {
            throw new StudyError("This questionnaire version is unavailable. Reload the study to review current questionnaires.", 409);
          }
          const answers = validateResponses(questionnaire, action.responses);
          const response = await tx.questionnaireResponse.create({ data: {
            ...actor, createdAt, instrumentId: questionnaire.id, version: questionnaire.version, timing: questionnaire.timing,
            activity: action.activity, artefactId: action.artefactId, responses: answers,
          } });
          await event("QUESTIONNAIRE_COMPLETED", {
            responseId: response.id, instrumentId: response.instrumentId, version: response.version,
            configVersion: config.configVersion, timing: response.timing,
          }, response.artefactId ?? undefined);
          break;
        }
      }

      if (resultId) await tx.studyMutation.update({ where: { id: key }, data: { resultId } });
      return resultId;
    });
  } catch (error) {
    const duplicate = await db.studyMutation.findUnique({ where: { id: key } });
    if (!duplicate) throw error;
    result = duplicate.resultId ?? undefined;
  }
  return result && (action.action === "upload" || action.action === "decision")
    ? getStoredResult(action.action, session.participantId, result) : {};
}
