import type { StudyState } from "./study-types";

export type StudyAction = (action: string, payload?: Record<string, unknown>) => Promise<StudyState>;

export const backendNames = { LIVE: "Live AI", MOCK: "Mock backend", WIZARD: "Researcher-assisted" };

export function errorMessage(cause: unknown) {
  return cause instanceof Error ? cause.message : "Something went wrong. Try again.";
}
