export const ROLES = ["Producer", "Composer", "Performer", "Vocalist", "Lyricist", "Improviser", "Other"] as const;
export const STAGES = ["Initiate", "Explore", "Develop", "Refine", "Prepare"] as const;
export const MODES = ["guide", "collaborate", "lead", "independent"] as const;
export const OUTPUT_TYPES = ["text", "workflow", "storyboard", "moodboard", "concept"] as const;
export const PROFILE_FIELDS = ["experience", "genres", "status", "tools", "aiExperience", "roles"] as const;

export type Role = typeof ROLES[number];
export type Stage = typeof STAGES[number];
export type Mode = typeof MODES[number];
export type OutputType = typeof OUTPUT_TYPES[number];
export type ProfileField = typeof PROFILE_FIELDS[number];
export type Backend = "LIVE" | "MOCK" | "WIZARD";
export type PromptSource = "suggested" | "modified" | "original";
export type Decision = "accept" | "adapt" | "reject" | "alternatives" | "save";

export interface Suggestion {
  id: string;
  role: Role;
  stage: Stage;
  text: string;
}
export interface QuestionnaireItem {
  id: string;
  type: "likert" | "slider" | "choice" | "pairwise" | "open";
  label: string;
  required?: boolean;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
}
export interface Questionnaire {
  id: string;
  name: string;
  version: string;
  timing: "activity" | "session" | "deployment";
  items: QuestionnaireItem[];
}
export interface StudySettings {
  backend: Backend;
  consentText: string;
  consentVersion: string;
  consentReady: boolean;
  configVersion: string;
  allowedModes: Mode[];
  suggestions: Suggestion[];
  maxImageBytes: number;
  profileFields: ProfileField[];
}
export interface Participant {
  id: string;
  publicId: string;
  consentAt: string | null;
  consentVersion: string | null;
  role: Role | null;
  roles: Role[];
  experience: number | null;
  genres: string | null;
  status: string | null;
  tools: string | null;
  aiExperience: string | null;
  activeRole: Role | null;
  stage: Stage;
  mode: Mode | "";
}
export interface StudySession {
  id: string;
  createdAt: string;
  expiresAt: string;
}

export type WorkflowPreference = "welcome" | "conditional" | "human" | "undecided";
export interface WorkflowNode {
  id: string;
  position: { x: number; y: number };
  data: { label: string; preference: WorkflowPreference; notes?: string };
}
export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}
export interface WorkflowGraph {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}
export interface WorkflowSnapshot extends WorkflowGraph {
  id: string;
  title: string;
  svg: string | null;
  png: string | null;
  createdAt: string;
}
export interface Annotation {
  id: string;
  text: string;
  createdAt: string;
}
export interface Artefact {
  id: string;
  title: string;
  text: string;
  imageUrl: string | null;
  outputType: OutputType;
  origin: "ai" | "human";
  backend: Backend | "MANUAL";
  status: "pending" | "completed" | "failed";
  parentId: string | null;
  decision: Decision | null;
  reflection: string | null;
  annotations: Annotation[];
  workflow: WorkflowGraph | null;
  prompt: string;
  promptSource: PromptSource;
  mode: Mode;
  createdAt: string;
}
export interface Upload {
  id: string;
  name: string;
  dataUrl: string;
  purpose: "sketch" | "diary" | "future";
  createdAt: string;
}
export interface DiaryAnswers {
  goal: string;
  usedAI: string;
  why: string;
  changes: string;
  intention: string;
  differently: string;
}
export interface DiaryEntry {
  id: string;
  sessionId: string;
  artefactId: string | null;
  attachmentId: string | null;
  answers: DiaryAnswers;
  createdAt: string;
}
export interface FutureProposal {
  id: string;
  description: string;
  acceptable: string;
  unacceptable: string;
  sketchId: string | null;
  artefactId: string | null;
  finalized: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface QuestionnaireResponse {
  id: string;
  sessionId: string;
  instrumentId: string;
  version: string;
  timing: Questionnaire["timing"];
  activity: string | null;
  artefactId: string | null;
  responses: Record<string, number | string>;
  createdAt: string;
}
export interface ResearchEvent {
  sequence: number;
  id: string;
  type: string;
  data: Record<string, unknown>;
  artefactId: string | null;
  sessionId: string;
  createdAt: string;
}
export interface StudyState {
  participant: Participant | null;
  session: StudySession | null;
  settings: StudySettings;
  artefacts: Artefact[];
  diary: DiaryEntry[];
  workflows: WorkflowSnapshot[];
  questionnaires: Questionnaire[];
  responses: QuestionnaireResponse[];
  future: FutureProposal | null;
  uploads: Upload[];
  events: ResearchEvent[];
  upload?: Upload;
  artefact?: Artefact;
}
