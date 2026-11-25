import type { Prisma } from "@prisma/client";
import { MODES, type Artefact, type Mode } from "@/lib/study-types";
import {
  configuredModel, effectiveImagePrompt, executeGeneration, imageSettings, isVisual, maxOutputTokens, outputTitles, ProviderError,
} from "./ai";
import { backendMode, integerEnv, type StudyConfig } from "./config";
import { db } from "./db";
import { MODE_PROMPTS, MODE_PROMPT_VERSION } from "./mode-prompts";
import { ownedArtefact, ownedUpload, promptOrigin } from "./mutations";
import { StudyError } from "./security";
import { recordEvent, researchEventId, type ParticipantSession } from "./session";
import { artefactView } from "./study-state";
import type { StudyAction } from "./validation";

const readAttempt = (key: string) => db.artefact.findUnique({ where: { requestKey: key }, include: { annotations: true } });
type Attempt = NonNullable<Awaited<ReturnType<typeof readAttempt>>>;

async function replayAttempt(row: Attempt, key: string, session: ParticipantSession) {
  if (row.status === "pending" && row.backend !== "WIZARD" && Date.now() - row.createdAt.getTime() > 125_000) {
    await db.$transaction(async (tx) => {
      const updated = await tx.artefact.updateMany({
        where: { id: row.id, status: "pending" },
        data: { status: "failed", text: "The generation was interrupted before a result was stored.", response: { error: "interrupted-generation" } },
      });
      if (updated.count) await recordEvent(tx, session, researchEventId(key, "GENERATION_FAILED"), "GENERATION_FAILED",
        { backend: row.backend, error: "interrupted-generation", source: "system" }, row.id);
    });
    row = await readAttempt(key) ?? row;
  }
  return { artefact: artefactView(row), error: row.status === "failed" ? row.text : undefined };
}

export async function generate(action: StudyAction<"generate">, config: StudyConfig, session: ParticipantSession, key: string): Promise<{ artefact: Artefact; error?: string }> {
  const existing = await readAttempt(key);
  if (existing) return replayAttempt(existing, key, session);
  const participant = session.participant;
  const mode = participant.mode as Mode;
  if (!MODES.includes(mode) || !config.allowedModes.includes(mode)) {
    throw new StudyError("Select an available AI collaboration mode before generating.");
  }
  if (mode === "independent") throw new StudyError("AI generation is disabled in Work independently.", 403);

  const source = promptOrigin(config, action.prompt, action.promptSource, action.suggestionId);
  const backend = backendMode();
  const visual = isVisual(action.outputType);
  const parent = action.parentId ? await ownedArtefact(db, session.participantId, action.parentId) : null;
  if (parent && parent.status !== "completed") throw new StudyError("Only completed artefacts can be used as the basis for a revision.");
  const reference = action.referenceId ? await ownedUpload(db, session.participantId, action.referenceId) : null;
  const referenceImage = visual ? reference?.dataUrl || parent?.imageUrl || null : null;
  const instructions = [
    MODE_PROMPTS[mode],
    action.outputType === "workflow" ? "Represent the plan as a graph of two to eight activities with readable labels and non-overlapping positions, at least 250 pixels between columns. Link existing node IDs only and use 'undecided' for each activity unless the participant states a preference." : "",
  ].filter(Boolean).join(" ");

  const participantIdentifiers = [participant.id, participant.publicId];
  const rawInput = [
    `Active musical role: ${participant.activeRole}. Creative stage: ${participant.stage}.`,
    parent ? `Earlier artefact title: ${parent.title}. Earlier response excerpt: ${parent.text.slice(0, 5000)}` : "",
    action.variations ? "The participant requests a genuinely different creative direction." : "",
    `Participant prompt:\n${action.prompt}`,
  ].filter(Boolean).join("\n\n");
  function removeParticipantIds(value: string) {
    return participantIdentifiers.reduce(
      (input, identifier) => input.replace(new RegExp(identifier, "gi"), "[participant ID removed]"),
      value,
    );
  }
  const providerInput = removeParticipantIds(rawInput);
  const providerStyle = action.style ? removeParticipantIds(action.style) : undefined;
  const imagePrompt = visual ? effectiveImagePrompt(action.outputType, instructions, providerInput, providerStyle, Boolean(referenceImage)) : null;
  const model = configuredModel(backend, action.outputType);
  const generationCost = backend === "LIVE" ? visual
    ? integerEnv("IMAGE_GENERATION_COST_CENTS", 20, 1)
    : integerEnv("TEXT_GENERATION_COST_CENTS", 3, 1) : 0;
  const budget = integerEnv("PARTICIPANT_BUDGET_CENTS", 200, 0);
  const callLimit = integerEnv("PARTICIPANT_GENERATION_LIMIT", 100, 1, 10_000);
  const parameters = {
    configVersion: config.configVersion,
    modePromptVersion: MODE_PROMPT_VERSION,
    activeRole: participant.activeRole,
    stage: participant.stage,
    estimatedCostCents: generationCost,
    rolePrompt: source.suggestion?.text ?? null,
    variant: action.variations ? "alternative" : "initial",
    style: action.style ?? null,
    referenceUploadId: reference?.id ?? null,
    referenceArtefactId: referenceImage && !reference ? parent?.id ?? null : null,
    providerInput,
    ...(visual ? { ...imageSettings, submittedImagePrompt: imagePrompt } : { max_output_tokens: maxOutputTokens, store: false }),
  } satisfies Prisma.InputJsonObject;

  let pending: Attempt;
  try {
    pending = await db.$transaction(async (tx) => {
      const row = await tx.artefact.create({
        data: {
          requestKey: key, participantId: session.participantId, sessionId: session.id, parentId: parent?.id,
          title: outputTitles[action.outputType], text: "", outputType: action.outputType, origin: "ai", backend,
          status: "pending", model, systemPrompt: instructions, imagePrompt, prompt: action.prompt, createdAt: new Date(),
          promptSource: source.source, suggestionId: source.suggestion?.id, mode, parameters, response: {},
        },
        include: { annotations: true },
      });
      if (await tx.artefact.count({ where: { participantId: session.participantId, origin: "ai" } }) > callLimit) {
        throw new StudyError("The study generation limit was reached.", 429);
      }
      if (generationCost) {
        const reserved = await tx.participant.updateMany({
          where: { id: session.participantId, spentCents: { lte: budget - generationCost } },
          data: { spentCents: { increment: generationCost } },
        });
        if (!reserved.count) throw new StudyError("The study generation budget was reached.", 429);
      }
      await recordEvent(tx, session, researchEventId(key, "PROMPT_SUBMITTED"), "PROMPT_SUBMITTED", {
        prompt: action.prompt, promptSource: source.source, suggestedText: source.suggestion?.text ?? null,
        suggestionId: source.suggestion?.id ?? null, outputType: action.outputType, mode,
        role: participant.activeRole, stage: participant.stage, parentId: parent?.id ?? null,
        configVersion: config.configVersion,
      }, row.id);
      await recordEvent(tx, session, researchEventId(key, "GENERATION_STARTED"), "GENERATION_STARTED",
        { backend, model, outputType: action.outputType, mode, estimatedCostCents: generationCost }, row.id);
      return row;
    });
  } catch (error) {
    const duplicate = await readAttempt(key);
    if (duplicate) return replayAttempt(duplicate, key, session);
    throw error;
  }

  if (backend === "WIZARD") return { artefact: artefactView(pending) };

  let generated: Awaited<ReturnType<typeof executeGeneration>>;
  try {
    generated = await executeGeneration({
      backend, mode, outputType: action.outputType, model, instructions, input: providerInput,
      imagePrompt, referenceImage, alternate: Boolean(action.variations || action.parentId),
    });
  } catch (error) {
    const errorCode = error instanceof ProviderError ? error.code : "generation-error";
    const errorMessage = error instanceof ProviderError ? error.message : "The generation could not be completed.";
    const failed = await db.$transaction(async (tx) => {
      const row = await tx.artefact.update({
        where: { id: pending.id }, include: { annotations: true },
        data: { status: "failed", text: errorMessage, response: { error: errorCode } },
      });
      if (generationCost && errorCode === "configuration") {
        await tx.participant.update({ where: { id: session.participantId }, data: { spentCents: { decrement: generationCost } } });
      }
      await recordEvent(tx, session, researchEventId(key, "GENERATION_FAILED"), "GENERATION_FAILED", {
        backend, model, error: errorCode, source: "system", budgetRefunded: generationCost > 0 && errorCode === "configuration",
      }, pending.id);
      return row;
    });
    return { artefact: artefactView(failed), error: errorMessage };
  }

  const completed = await db.$transaction(async (tx) => {
    const row = await tx.artefact.update({
      where: { id: pending.id }, include: { annotations: true },
      data: {
        status: "completed", title: generated.title, text: generated.text, model: generated.model,
        response: generated.response, workflow: generated.workflow as unknown as Prisma.InputJsonValue,
        imageUrl: generated.imageUrl, imagePrompt: generated.imagePrompt,
      },
    });
    await recordEvent(tx, session, researchEventId(key, "GENERATION_COMPLETED"), "GENERATION_COMPLETED",
      { backend, model: generated.model, outputType: action.outputType }, pending.id);
    return row;
  });
  return { artefact: artefactView(completed) };
}
