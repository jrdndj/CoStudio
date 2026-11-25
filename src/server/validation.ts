import { z } from "zod";
import { MODES, OUTPUT_TYPES, ROLES, STAGES, type Questionnaire } from "@/lib/study-types";
import { StudyError } from "./security";

const eventId = z.string().trim().min(8).max(100).optional();
const id = z.string().trim().min(1).max(100);
const optionalText = (length: number) => z.string().trim().max(length).optional();
const requiredText = (length: number) => z.string().trim().min(1).max(length);
const preferences = z.enum(["welcome", "conditional", "human", "undecided"]);

export const diagramSchema = z.object({
  nodes: z.array(z.object({
    id,
    position: z.object({ x: z.number().min(-6000).max(6000), y: z.number().min(-6000).max(6000) }),
    data: z.object({ label: requiredText(100), preference: preferences, notes: optionalText(1000) }),
  })).min(1).max(60),
  edges: z.array(z.object({ id, source: id, target: id, label: optionalText(80) })).max(120),
}).superRefine(({ nodes, edges }, context) => {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edgeIds = new Set(edges.map((edge) => edge.id));
  if (nodeIds.size !== nodes.length || edgeIds.size !== edges.length) {
    context.addIssue({ code: "custom", message: "Node and connection IDs must be unique." });
  }
  if (edges.some((edge) => !nodeIds.has(edge.source) || !nodeIds.has(edge.target))) {
    context.addIssue({ code: "custom", message: "Connections must link nodes in this diagram." });
  }
});

export const studyAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("state") }),
  z.object({ action: z.literal("redeem"), code: requiredText(100), eventId }),
  z.object({ action: z.literal("consent"), accepted: z.literal(true), version: optionalText(100), eventId }),
  z.object({ action: z.literal("profile"), role: z.enum(ROLES), roles: z.array(z.enum(ROLES)).max(7).default([]), experience: z.coerce.number().int().min(0).max(100).optional(), genres: optionalText(1000), status: optionalText(100), tools: optionalText(1000), aiExperience: optionalText(1000), eventId }),
  z.object({ action: z.literal("select"), role: z.enum(ROLES).optional(), stage: z.enum(STAGES).optional(), mode: z.enum(MODES).optional(), eventId }),
  z.object({ action: z.literal("prompt"), kind: z.enum(["selected", "edited"]), text: requiredText(10000), suggestionId: id.optional(), eventId }),
  z.object({ action: z.literal("generate"), prompt: requiredText(10000), promptSource: z.enum(["suggested", "modified", "original"]), suggestionId: id.optional(), outputType: z.enum(OUTPUT_TYPES), parentId: id.optional(), style: optionalText(200), referenceId: id.optional(), variations: z.boolean().optional(), eventId }),
  z.object({ action: z.literal("decision"), artefactId: id, decision: z.enum(["accept", "adapt", "reject", "alternatives", "save"]), reflection: optionalText(4000), title: optionalText(160), text: optionalText(15000), workflow: diagramSchema.optional(), eventId }),
  z.object({ action: z.literal("annotate"), artefactId: id, text: requiredText(4000), eventId }),
  z.object({ action: z.literal("view"), artefactId: id, eventId }),
  z.object({ action: z.literal("upload"), name: requiredText(160), dataUrl: z.string(), purpose: z.enum(["sketch", "diary", "future"]).default("sketch"), eventId }),
  z.object({ action: z.literal("diary"), answers: z.object({ goal: requiredText(4000), usedAI: requiredText(100), why: requiredText(4000), changes: optionalText(4000).default(""), intention: requiredText(4000), differently: optionalText(4000).default("") }), artefactId: id.nullish(), attachmentId: id.nullish(), eventId }),
  z.object({ action: z.literal("workflow"), title: requiredText(160), nodes: z.unknown(), edges: z.unknown(), eventId }),
  z.object({ action: z.literal("future"), description: requiredText(8000), acceptable: optionalText(4000).default(""), unacceptable: optionalText(4000).default(""), sketchId: id.nullish(), artefactId: id.nullish(), finalized: z.boolean().default(false), eventId }),
  z.object({ action: z.literal("questionnaire"), instrumentId: id, version: id, responses: z.record(id, z.union([z.string().trim().max(4000), z.number()])), activity: optionalText(160), artefactId: id.nullish(), eventId }),
  z.object({ action: z.literal("logout"), eventId }),
]);

type Action = z.infer<typeof studyAction>;
export type StudyAction<Name extends Action["action"] = Action["action"]> = Extract<Action, { action: Name }>;

export function validateResponses(questionnaire: Questionnaire, responses: Record<string, string | number>) {
  const ids = new Set(questionnaire.items.map((item) => item.id));
  if (Object.keys(responses).some((key) => !ids.has(key))) {
    throw new StudyError("One or more responses do not match the configured questionnaire.");
  }
  const validated: Record<string, string | number> = Object.create(null);
  for (const item of questionnaire.items) {
    const value = responses[item.id];
    if (value === undefined || value === "") {
      if (item.required !== false) throw new StudyError(`Answer “${item.label}” before submitting.`);
      continue;
    }
    if (item.type === "likert" || item.type === "slider") {
      const minimum = item.min ?? 1;
      const maximum = item.max ?? 7;
      const step = item.step ?? 1;
      if (typeof value !== "number" || value < minimum || value > maximum
        || Math.abs((value - minimum) / step - Math.round((value - minimum) / step)) > 1e-6) {
        throw new StudyError(`The response to “${item.label}” is outside the configured scale.`);
      }
    } else if (item.type === "choice" || item.type === "pairwise") {
      if (typeof value !== "string" || !item.options?.includes(value)) {
        throw new StudyError(`Select one configured option for “${item.label}”.`);
      }
    } else if (typeof value !== "string") {
      throw new StudyError(`Enter a written response to “${item.label}”.`);
    }
    validated[item.id] = value;
  }
  return validated;
}
