import type { AnalysisStage } from "./goal-analysis";
import type { PersonaMode, RouteComparison } from "./goal-types";

// Petición del análisis. `goal` es el texto del campo de objetivo de la
// barra, tal cual lo escribió el usuario (o lo puso un chip).
export type AnalysisRequest = {
  url: string;
  goal: string;
  personaMode: PersonaMode;
  customPersona?: string;
};

// Eventos del stream de /api/goal/stream, uno por línea (NDJSON).
export type AnalysisEvent =
  | { type: "stage"; stage: AnalysisStage }
  | { type: "result"; result: RouteComparison }
  | { type: "error"; message: string; stage: AnalysisStage | null };

// Validación compartida. Devuelve la petición limpia o el motivo del rechazo.
export function validateAnalysisRequest(
  body: unknown
): { ok: true; request: AnalysisRequest } | { ok: false; error: string } {
  const { url, goal, personaMode, customPersona } = (body ?? {}) as {
    url?: string;
    goal?: string;
    personaMode?: string;
    customPersona?: string;
  };

  if (!url) return { ok: false, error: "URL is required" };
  try {
    new URL(url);
  } catch {
    return { ok: false, error: "Invalid URL format" };
  }

  if (typeof goal !== "string" || !goal.trim()) {
    return { ok: false, error: "A goal is required" };
  }

  const mode: PersonaMode = personaMode === "personal" ? "personal" : "automatic";
  if (mode === "personal" && (!customPersona || customPersona.trim().length < 10)) {
    return { ok: false, error: "Describe your user in at least a few words" };
  }

  return {
    ok: true,
    request: { url, goal: goal.trim(), personaMode: mode, customPersona },
  };
}

// Primera línea del mensaje: los errores de Playwright traen el log de
// llamadas debajo, que no sirve en pantalla.
export function errorReason(error: unknown): string {
  if (error instanceof Error && error.message) return error.message.split("\n")[0].trim();
  if (typeof error === "string" && error) return error;
  return "Unknown error";
}
