import type { AnalysisStage } from "./goal-analysis";
import type { PersonaMode, RouteComparison } from "./goal-types";
import type { Failure } from "../llm/model-errors";

// Petición del análisis. `goal` es el texto del campo de objetivo de la
// barra, tal cual lo escribió el usuario (o lo puso un chip).
export type AnalysisRequest = {
  url: string;
  goal: string;
  personaMode: PersonaMode;
  customPersona?: string;
};

// Eventos del stream de /api/goal/stream, uno por línea (NDJSON). El error
// trae el motivo real (Failure): cuota, tiempo, sitio… y si tiene sentido
// reintentar, y cuándo.
export type AnalysisEvent =
  | { type: "stage"; stage: AnalysisStage }
  | { type: "result"; result: RouteComparison }
  | ({ type: "error"; stage: AnalysisStage | null } & Failure);

// Topes de la petición. La URL más larga razonable, un objetivo de una o
// dos frases y la descripción de un perfil.
export const MAX_URL = 2048;
export const MAX_GOAL = 500;
export const MAX_PERSONA = 2000;
export const MAX_ANALYSIS_BODY = 8_000;

const FIELDS = new Set(["url", "goal", "personaMode", "customPersona"]);

// Esquema estricto (paso 9): solo los campos esperados, con su tipo y su
// largo. Lo que no encaje se rechaza antes de abrir el navegador o de
// gastar una llamada al modelo. Devuelve la petición limpia o el motivo.
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
