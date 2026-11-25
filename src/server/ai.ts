import type { Prisma } from "@prisma/client";
import sharp from "sharp";
import { z } from "zod";
import type { Backend, Mode, OutputType, WorkflowGraph } from "@/lib/study-types";
import { xml } from "./diagrams";
import { readImageData } from "./security";
import { diagramSchema } from "./validation";

export const outputTitles: Record<OutputType, string> = {
  text: "Creative suggestions",
  workflow: "Workflow map",
  storyboard: "Narrative storyboard",
  moodboard: "Visual moodboard",
  concept: "Studio concept sketch",
};

export function isVisual(outputType: OutputType) {
  return outputType === "storyboard" || outputType === "moodboard" || outputType === "concept";
}

export function configuredModel(backend: Backend, outputType: OutputType) {
  if (backend !== "LIVE") return null;
  return (isVisual(outputType) ? process.env.OPENAI_IMAGE_MODEL : process.env.OPENAI_TEXT_MODEL)?.trim() || null;
}

const visualDirection: Record<"storyboard" | "moodboard" | "concept", string> = {
  storyboard: "Draw a rough four-panel storyboard of musical or narrative moments. Use clear composition, generous space, and sketch lines.",
  moodboard: "Assemble a restrained conceptual moodboard with distinct swatches, abstract textures, and sketches. Organize the visual relationships clearly.",
  concept: "Make an annotated architectural concept sketch or interface wireframe of the music-making environment. Leave room for design revision. Depict the environment the participant describes.",
};

export function effectiveImagePrompt(outputType: OutputType, instructions: string, input: string, style?: string, editing?: boolean) {
  const direction = outputType === "storyboard" || outputType === "moodboard" || outputType === "concept" ? visualDirection[outputType] : "";
  return [
    instructions, direction, "Use low-fidelity exploratory visual language suitable for a research sketch.",
    style?.trim() ? `Preferred visual style: ${style}` : "Default visual style: hand-drawn charcoal and ink with sparse desaturated accents.",
    editing ? "Use the supplied image as a reference. Keep elements in it unless the participant asks to change them." : "",
    input,
  ].filter(Boolean).join("\n\n");
}

const preferenceSchema = { type: "string", enum: ["welcome", "conditional", "human", "undecided"] };
const pointSchema = {
  type: "object", properties: { x: { type: "number" }, y: { type: "number" } },
  required: ["x", "y"], additionalProperties: false,
};
const jsonString = { type: "string" };
const dataSchema = {
  type: "object", properties: { label: jsonString, preference: preferenceSchema, notes: jsonString },
  required: ["label", "preference", "notes"], additionalProperties: false,
};
const nodeSchema = {
  type: "object", properties: { id: jsonString, position: pointSchema, data: dataSchema },
  required: ["id", "position", "data"], additionalProperties: false,
};
const edgeSchema = {
  type: "object", properties: { id: jsonString, source: jsonString, target: jsonString, label: jsonString },
  required: ["id", "source", "target", "label"], additionalProperties: false,
};
const textProperties = { title: jsonString, text: jsonString };
const workflowProperties = { ...textProperties, nodes: { type: "array", items: nodeSchema }, edges: { type: "array", items: edgeSchema } };
const textResponseValidator = z.object({ title: z.string().trim().min(1).max(160), text: z.string().trim().min(1).max(15000) });
const responseEnvelope = z.object({
  status: z.string(),
  id: z.string(),
  model: z.string(),
  output: z.array(z.object({ type: z.string(), content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional() })),
  usage: z.unknown().optional(),
});
const imageEnvelope = z.object({
  data: z.array(z.object({ b64_json: z.string(), revised_prompt: z.string().optional() })).min(1),
  usage: z.unknown().optional(),
});

export const maxOutputTokens = 2500;
export const imageSettings = { n: 1, size: "1024x1024", quality: "medium", output_format: "webp" } as const;

interface GenerateInput {
  backend: Exclude<Backend, "WIZARD">;
  mode: Mode;
  outputType: OutputType;
  model: string | null;
  instructions: string;
  input: string;
  imagePrompt: string | null;
  referenceImage: string | null;
  alternate: boolean;
}

export interface GenerateResult {
  title: string;
  text: string;
  model: string | null;
  response: Prisma.InputJsonObject;
  workflow?: WorkflowGraph;
  imageUrl?: string;
  imagePrompt?: string;
}

export class ProviderError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
}

async function providerRequest(path: string, body: FormData | Record<string, unknown>) {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new ProviderError("configuration", "The live generation credentials are missing.");
  const headers: Record<string, string> = { Authorization: `Bearer ${key}` };
  if (!(body instanceof FormData)) headers["Content-Type"] = "application/json";
  let response: Response;
  try {
    response = await fetch(`https://api.openai.com/v1/${path}`, {
      method: "POST", headers,
      body: body instanceof FormData ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(105_000),
      cache: "no-store",
    });
  } catch {
    throw new ProviderError("connection", "The live generation provider could not be reached.");
  }
  if (!response.ok) {
    throw new ProviderError(`http-${response.status}`, "The live generation provider declined the request.");
  }
  try {
    return { data: await response.json() as unknown, requestId: response.headers.get("x-request-id") };
  } catch {
    throw new ProviderError("malformed-response", "The live generation provider returned an unreadable response.");
  }
}

async function generateText(options: GenerateInput): Promise<GenerateResult> {
  const workflow = options.outputType === "workflow";
  const properties = workflow ? workflowProperties : textProperties;
  const schema = { type: "object", properties, required: Object.keys(properties), additionalProperties: false };
  const { data, requestId } = await providerRequest("responses", {
    model: options.model,
    instructions: options.instructions,
    input: options.input,
    store: false,
    max_output_tokens: maxOutputTokens,
    text: { format: { type: "json_schema", name: workflow ? "workflow_map" : "creative_suggestions", schema, strict: true } },
  });
  const envelope = responseEnvelope.safeParse(data);
  if (!envelope.success || envelope.data.status !== "completed") {
    throw new ProviderError("incomplete-response", "The live text response did not complete.");
  }
  const pieces = envelope.data.output.flatMap((item) =>
    (item.content ?? []).filter((part) => part.type === "output_text").map((part) => part.text ?? ""));
  const content = pieces.join("");
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new ProviderError("invalid-structured-output", "The live text response could not be validated.");
  }
  const summary = textResponseValidator.safeParse(parsed);
  const graph = workflow ? diagramSchema.safeParse(parsed) : null;
  if (!summary.success || (graph && !graph.success)) {
    throw new ProviderError("invalid-structured-output", "The live text response did not meet the output schema.");
  }
  return {
    ...summary.data,
    model: envelope.data.model,
    workflow: graph?.data,
    response: {
      providerResponseId: envelope.data.id, providerRequestId: requestId, output: content,
      usage: (envelope.data.usage ?? null) as Prisma.InputJsonValue,
    },
  };
}

async function generateImage(options: GenerateInput): Promise<GenerateResult> {
  const payload = { ...imageSettings, model: options.model, prompt: options.imagePrompt };
  let body: FormData | Record<string, unknown> = payload;
  let path = "images/generations";
  if (options.referenceImage) {
    const { data, format } = readImageData(options.referenceImage, 12 * 1024 * 1024);
    const form = new FormData();
    for (const [key, value] of Object.entries(payload)) form.set(key, String(value));
    form.append("image[]", new Blob([new Uint8Array(data)], { type: `image/${format}` }), `reference.${format}`);
    path = "images/edits";
    body = form;
  }
  const { data, requestId } = await providerRequest(path, body);
  const parsed = imageEnvelope.safeParse(data);
  if (!parsed.success) throw new ProviderError("invalid-image-response", "The live image response contained no usable image.");
  const image = parsed.data.data[0];
  const imageUrl = `data:image/webp;base64,${image.b64_json}`;
  const { data: bytes } = readImageData(imageUrl, 12 * 1024 * 1024);
  const format = await sharp(bytes, { limitInputPixels: 16_000_000 }).metadata();
  if (format.format !== "webp") throw new ProviderError("invalid-image-format", "The provider returned an unexpected image format.");
  return {
    title: outputTitles[options.outputType],
    text: "",
    model: options.model,
    imageUrl,
    ...(image.revised_prompt ? { imagePrompt: image.revised_prompt } : {}),
    response: {
      providerRequestId: requestId, revisedPrompt: image.revised_prompt ?? null,
      usage: (parsed.data.usage ?? null) as Prisma.InputJsonValue, imageStored: true,
    },
  };
}

const fixtureText: Record<Mode, { title: string; text: string }> = {
  guide: {
    title: "Questions for the next pass",
    text: "What quality of the idea do you most want to preserve?\n\nChoose one constraint for a ten-minute experiment. Afterward, ask which part you would keep and why.\n\nHow will you know the result feels closer to your intention?",
  },
  collaborate: {
    title: "Two directions to try",
    text: "A · Work small. Isolate one element and make two short variations. The narrow scope makes the differences easier to hear.\n\nB · Change context. Put the same element next to contrasting material. You may discover new relationships, with more moving parts to compare.\n\nSelect one direction or combine the first step from each.",
  },
  lead: {
    title: "A starting proposal",
    text: "Assumption: you want a short experiment before committing to a direction.\n\n1. Start with the fragment you want to preserve.\n2. Give it a sparse introduction, then vary one layer after the first transition.\n3. Compare that change with a version where the transition is delayed.\n\nKeep the version that best fits your intent, or rewrite the plan around another listening goal.",
  },
  independent: { title: "", text: "" },
};

function fixtureGraph(mode: Mode, alternate: boolean): WorkflowGraph {
  const labels = alternate ? ["Try a contrasting constraint", "Listen and compare", "Decide what to keep"] : mode === "guide"
    ? ["What matters to you?", "What can you try?", "What did you learn?"]
    : mode === "collaborate" ? ["Choose a direction", "Combine or revise", "Review the result"]
      : ["Identify an anchor", "Try an initial arrangement", "Revise the transition"];
  return {
    nodes: labels.map((label, index) => ({ id: `step-${index}`, position: { x: index * 270, y: 90 + index % 2 * 90 }, data: { label, preference: "undecided" } })),
    edges: [{ id: "link-1", source: "step-0", target: "step-1" }, { id: "link-2", source: "step-1", target: "step-2" }],
  };
}

async function fixtureImage(type: OutputType, mode: Mode, alternate: boolean) {
  const accent = alternate || mode === "lead" ? "#855883" : "#416d67";
  const pen = "#4d475b";
  const lines = type === "concept"
    ? `<path d="M470 647 182 515 183 336 492 176 822 321 822 523 470 647Z M183 336 471 466 822 321 M471 466V647 M302 298l278 131 M613 414v120l121-53V361 M213 382l148 66v68l-148-67z" fill="none" stroke="${pen}" stroke-width="5" stroke-linejoin="round"/>
      <path d="m510 467 82-39v45l-82 39z M643 450l55-27v41l-55 26z M551 555l164-72 55 23-167 78z" fill="${accent}" opacity=".55"/>
      <path d="M241 461 136 550H70 M652 254l120-83h130 M710 526l61 86h137" fill="none" stroke="${accent}" stroke-width="2" stroke-dasharray="8 6"/>
      <text x="65" y="579">listening area</text><text x="770" y="153">quiet zone</text><text x="770" y="640">shared controls</text>`
    : type === "moodboard"
      ? `<path d="M116 230h258v198H116z" fill="${pen}"/><path d="M397 230h252v198H397z" fill="${accent}"/><path d="M671 230h211v198H671z" fill="#baa360"/>
      <path d="M116 471h383v172H116z" fill="#e7d7c2"/><path d="M522 471h360v172H522z" fill="#d0c3d7"/>
      <path d="M138 335c40-90 81 82 122 0s57-65 104 0M425 313c41-32 66 76 100 24s52-66 97 4M549 559c45-59 75 39 122 0s76 41 172 14" fill="none" stroke="#fbf6ed" stroke-width="9"/>`
      : `<g fill="none" stroke="${pen}" stroke-width="3"><rect x="108" y="223" width="365" height="180" rx="4"/><rect x="529" y="223" width="365" height="180" rx="4"/><rect x="108" y="449" width="365" height="180" rx="4"/><rect x="529" y="449" width="365" height="180" rx="4"/></g>
      <path d="m141 349 91-60 100 56 115-45 M561 309q80-94 145 5t151-10 M144 570q48-94 92-44t100 27 98-34 M562 552q75-51 136-3t159-6" fill="none" stroke="${accent}" stroke-width="7"/>
      <text x="134" y="259">introduce</text><text x="554" y="259">develop</text><text x="134" y="485">interrupt</text><text x="554" y="485">return</text>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="768" viewBox="0 0 1024 768">
    <defs><pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M 24 0 L 0 0 0 24" fill="none" stroke="#c3c0b9" opacity=".4"/></pattern></defs>
    <rect width="1024" height="768" fill="#f2ece1"/><rect x="42" y="44" width="940" height="680" fill="url(#grid)" stroke="#c9c2b5"/>
    <g fill="${pen}" font-family="sans-serif" font-size="20">${lines}
    <text x="69" y="109" font-size="33" font-weight="700">${xml(outputTitles[type])}</text>
    <text x="70" y="695" fill="${accent}" font-size="16" letter-spacing="2">DEVELOPMENT FIXTURE · ${alternate ? "ALTERNATIVE STUDY" : "CONCEPT STUDY"}</text></g></svg>`;
  const image = await sharp(Buffer.from(svg)).webp({ quality: 90 }).toBuffer();
  return `data:image/webp;base64,${image.toString("base64")}`;
}

export async function executeGeneration(options: GenerateInput): Promise<GenerateResult> {
  if (options.backend === "LIVE") {
    if (!options.model) throw new ProviderError("configuration", "The model for this live output type has not been configured.");
    return isVisual(options.outputType) ? generateImage(options) : generateText(options);
  }
  const preset = fixtureText[options.mode];
  const visual = isVisual(options.outputType);
  const workflow = options.outputType === "workflow" ? fixtureGraph(options.mode, options.alternate) : undefined;
  const title = visual || workflow ? outputTitles[options.outputType] : preset.title;
  const text = options.alternate && !visual
    ? `${preset.text}\n\nAlternative fixture: reverse the order of two steps and compare what becomes clearer or harder.`
    : !visual ? preset.text : "This prebuilt conceptual image demonstrates how visual artefacts appear in the workspace.";
  return {
    title, text, model: null, workflow,
    imageUrl: visual ? await fixtureImage(options.outputType, options.mode, options.alternate) : undefined,
    response: { fixture: `costudio-fixture-1/${options.mode}/${options.outputType}`, variant: options.alternate ? "alternative" : "initial", output: text },
  };
}
