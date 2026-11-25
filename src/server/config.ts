import { MODES, PROFILE_FIELDS, ROLES, STAGES, type Backend, type Mode, type ProfileField, type Questionnaire, type Suggestion } from "@/lib/study-types";
import { db } from "./db";

export const CONSENT_PLACEHOLDER =
  "The research team has not added approved study information and consent content.";

const mockConsent =
  "This credential-free development instance contains fabricated AI fixtures. Use fictional material only. The prototype records your prompts, selections, and study activities in its local database as you try the workflow.";

const rolePrompts: Record<typeof ROLES[number], string[]> = {
  Producer: [
    "Help me describe the mood and sonic palette for this production.",
    "Help me visualize two alternative arrangements for the musical material I already have.",
    "Help me break down the next production tasks and decide which ones to try first.",
    "Suggest listening checks I can use to evaluate my mix.",
    "Help me plan the order and resources for a recording session.",
  ],
  Composer: [
    "Suggest creative constraints for a new composition without composing the piece for me.",
    "Help me explore alternative directions for an unfinished musical idea.",
    "Help me organize the structure of a composition.",
    "Help me visualize relationships between musical ideas and identify transitions I could revisit.",
    "Help me make a checklist for preparing a score for rehearsal.",
  ],
  Performer: [
    "Ask me questions that could clarify my intention for this performance.",
    "Help me explore different interpretations of a piece.",
    "Suggest a rehearsal structure for working on difficult passages.",
    "Suggest improvisational constraints that I can try and evaluate myself.",
    "Help me plan the expressive arc of a performance.",
  ],
  Vocalist: [
    "Ask me what I want a listener to feel as I sing this song.",
    "Help me explore the emotional progression of a song.",
    "Help me plan my phrasing and expressive delivery.",
    "Suggest a practice experiment to test different ways of delivering one phrase.",
    "Help me organize a vocal practice session for an upcoming performance.",
  ],
  Lyricist: [
    "Suggest thematic directions without writing the lyrics for me.",
    "Help me explore the narrative behind a song.",
    "Help me visualize the emotional progression of my lyrics.",
    "Ask me questions I can use to evaluate a lyric revision.",
    "Help me choose ideas to bring into a co-writing session.",
  ],
  Improviser: [
    "Help me define an intention I can bring into an improvisation.",
    "Suggest contrasting starting constraints for a short improvisation.",
    "Help me plan how to develop a motif in the moment.",
    "Suggest ways I can listen back and compare different takes.",
    "Help me prepare prompts to share with other improvisers.",
  ],
  Other: [
    "Ask me questions about the musical activity I want to begin.",
    "Suggest contrasting ways to explore the material I brought.",
    "Help me identify a next step and a way to record what I try.",
    "Help me decide which aspects to revisit while refining this work.",
    "Help me plan what I need to prepare for the next session.",
  ],
};

const defaultSuggestions: Suggestion[] = ROLES.flatMap((role) =>
  STAGES.map((stage, index) => ({
    id: `${role.toLowerCase()}-${stage.toLowerCase()}`,
    role,
    stage,
    text: rolePrompts[role][index],
  }))
);

const instrumentPlaceholders: Questionnaire[] = [
  { id: "nasa-tlx", name: "NASA-TLX", version: "unconfigured", timing: "activity", items: [] },
  { id: "creativity-support-index", name: "Creativity Support Index", version: "unconfigured", timing: "session", items: [] },
  { id: "state-sense-of-agency", name: "State sense of agency", version: "unconfigured", timing: "activity", items: [] },
  { id: "psychological-ownership", name: "Psychological ownership", version: "unconfigured", timing: "deployment", items: [] },
  { id: "creative-agency-exploratory", name: "Exploratory creative agency", version: "unconfigured", timing: "session", items: [] },
];

const mockInstrument: Questionnaire = {
  id: "mock-demo",
  name: "Development questionnaire fixture",
  version: "fixture-1",
  timing: "activity",
  items: [
    { id: "interface", type: "likert", label: "For this fictional trial, how easy was it to find the interaction history?", min: 1, max: 5 },
    { id: "notes", type: "open", label: "Enter a fictional observation about the layout.", required: false },
  ],
};

export function backendMode(): Backend {
  const value = process.env.AI_BACKEND?.trim() || "LIVE";
  if (value === "LIVE" || value === "MOCK" || value === "WIZARD") return value;
  throw new Error("AI_BACKEND must be LIVE, MOCK, or WIZARD.");
}

export function integerEnv(name: string, fallback: number, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  const value = process.env[name];
  if (!value) return fallback;
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < minimum || count > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return count;
}

export function profileFields(): ProfileField[] {
  const value = process.env.STUDY_PROFILE_FIELDS;
  if (value === undefined) return [...PROFILE_FIELDS];
  const configured = value.split(",").map((key) => key.trim()).filter(Boolean);
  if (configured.some((field) => !PROFILE_FIELDS.includes(field as ProfileField))) {
    throw new Error("STUDY_PROFILE_FIELDS contains an unknown optional field.");
  }
  return [...new Set(configured)] as ProfileField[];
}

export function createDefaultConfig() {
  const consentText = process.env.STUDY_CONSENT_TEXT?.trim();
  const consentVersion = process.env.STUDY_CONSENT_VERSION?.trim();
  const mock = backendMode() === "MOCK";
  return {
    id: "study",
    consentText: consentText || (mock ? mockConsent : CONSENT_PLACEHOLDER),
    consentVersion: consentText && consentVersion ? consentVersion : mock && !consentText ? "development-1" : "unconfigured",
    configVersion: "builtin-1",
    allowedModes: [...MODES] as Mode[],
    suggestions: defaultSuggestions,
    questionnaires: mock ? [...instrumentPlaceholders, mockInstrument] : instrumentPlaceholders,
    updatedAt: new Date(0),
  };
}

export async function getStudyConfig() {
  const defaults = createDefaultConfig();
  const saved = await db.researchConfig.findUnique({ where: { id: "study" } });
  if (!saved) return defaults;
  return {
    ...saved,
    allowedModes: saved.allowedModes as Mode[],
    suggestions: saved.suggestions as unknown as Suggestion[],
    questionnaires: saved.questionnaires as unknown as Questionnaire[],
  };
}

export type StudyConfig = Awaited<ReturnType<typeof getStudyConfig>>;

export function consentReady(config: StudyConfig) {
  if (backendMode() === "MOCK") return true;
  return Boolean(config.consentText.trim()) && config.consentText !== CONSENT_PLACEHOLDER
    && !["", "development-1", "unconfigured"].includes(config.consentVersion);
}
