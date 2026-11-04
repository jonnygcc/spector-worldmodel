import type { AnalysisStage } from "./goal-analysis";
import type { PersonaMode, RouteComparison } from "./goal-types";
import type { Failure } from "../llm/model-errors";

// `goal` is the bar's goal field text as typed (or as a chip filled it).
export type AnalysisRequest = {
  url: string;
  goal: string;
  personaMode: PersonaMode;
  customPersona?: string;
};

// One NDJSON line per event; the error carries the real reason (Failure) and whether and when to retry.
export type AnalysisEvent =
  | { type: "stage"; stage: AnalysisStage }
  | { type: "result"; result: RouteComparison }
  | ({ type: "error"; stage: AnalysisStage | null } & Failure);

// The longest reasonable URL, a one- or two-sentence goal and a profile description.
export const MAX_URL = 2048;
export const MAX_GOAL = 500;
export const MAX_PERSONA = 2000;
export const MAX_ANALYSIS_BODY = 8_000;

const FIELDS = new Set(["url", "goal", "personaMode", "customPersona"]);

// Strict schema: anything else is rejected before a browser opens or a model call is spent.
export function validateAnalysisRequest(
  body: unknown
): { ok: true; request: AnalysisRequest } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "The request must be a JSON object." };
  }
  const unknown = Object.keys(body).filter((key) => !FIELDS.has(key));
  if (unknown.length > 0) return { ok: false, error: `Unexpected field: ${unknown[0].slice(0, 40)}` };

  const { url, goal, personaMode, customPersona } = body as Record<string, unknown>;

  if (typeof url !== "string" || !url) return { ok: false, error: "URL is required" };
  if (url.length > MAX_URL) return { ok: false, error: "The URL is too long." };
  try {
    new URL(url);
  } catch {
    return { ok: false, error: "Invalid URL format" };
  }

  if (typeof goal !== "string" || !goal.trim()) return { ok: false, error: "A goal is required" };
  if (goal.length > MAX_GOAL) return { ok: false, error: `The goal is too long (max ${MAX_GOAL} characters).` };

  if (personaMode !== undefined && personaMode !== "automatic" && personaMode !== "personal") {
    return { ok: false, error: "Invalid persona mode" };
  }
  if (customPersona !== undefined && typeof customPersona !== "string") {
    return { ok: false, error: "Invalid persona description" };
  }
  if (typeof customPersona === "string" && customPersona.length > MAX_PERSONA) {
    return { ok: false, error: `The persona description is too long (max ${MAX_PERSONA} characters).` };
  }

  const mode: PersonaMode = personaMode === "personal" ? "personal" : "automatic";
  if (mode === "personal" && (!customPersona || customPersona.trim().length < 10)) {
    return { ok: false, error: "Describe your user in at least a few words" };
  }

  return {
    ok: true,
    request: { url, goal: goal.trim(), personaMode: mode, customPersona: mode === "personal" ? customPersona : undefined },
  };
}
