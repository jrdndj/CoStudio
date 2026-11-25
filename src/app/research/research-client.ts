import type { Questionnaire, Suggestion, Mode, Backend } from '@/lib/study-types';
import type { ResearchDataset } from '@/server/research-data';

type Serialized<T> = T extends Date ? string
  : T extends Array<infer Item> ? Serialized<Item>[]
  : T extends object ? { [Key in keyof T]: Serialized<T[Key]> }
  : T;

export type ParticipantDataset = Serialized<ResearchDataset>;

export type ResearchConfig = {
  configVersion: string;
  consentText: string;
  consentVersion: string;
  allowedModes: Mode[];
  suggestions: Suggestion[];
  questionnaires: Questionnaire[];
};

export type ParticipantSummary = {
  id: string;
  publicId: string;
  pictorialId: string;
  role: string | null;
  mode: string;
  stage: string;
  consentAt: string | null;
  createdAt: string;
  future: { finalized: boolean } | null;
  _count: { sessions: number; events: number; artefacts: number; diary: number; workflows: number; questionnaires: number };
};

export type ResearchOverview = {
  backend: Backend;
  consentReady: boolean;
  config: ResearchConfig;
  participants: ParticipantSummary[];
  codes: { id: string; createdAt: string; expiresAt: string | null; participant: { publicId: string } | null }[];
  wizard: {
    id: string; title: string; prompt: string; parentId: string | null; outputType: string; mode: string; createdAt: string;
    participant: { publicId: string };
  }[];
};

export const modeLabels: Record<string, string> = {
  guide: 'Guide me', collaborate: 'Collaborate with me', lead: 'Take the lead', independent: 'Work independently',
};

export const outputLabels: Record<string, string> = {
  text: 'Creative suggestions', workflow: 'Workflow map', storyboard: 'Storyboard', moodboard: 'Moodboard', concept: 'Concept sketch',
};

export const decisionLabels: Record<string, string> = {
  accept: 'Accepted', adapt: 'Adapted', reject: 'Rejected', alternatives: 'Alternatives requested', save: 'Saved for later',
};

export const dateTime = (date: string) => new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium', timeStyle: 'short',
}).format(new Date(date));

export class ResearchRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export async function researchRequest<T>(action: string, fields: Record<string, unknown> = {}) {
  const response = await fetch('/api/research', {
    method: 'POST',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...fields }),
  });
  const result = await response.json();
  if (!response.ok) throw new ResearchRequestError(result.error || 'The request failed.', response.status);
  return result as T;
}
