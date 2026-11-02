import type { AnalysisRequest } from "@/lib/worldmodel/analysis-events";
import type { PersonaMode } from "@/lib/worldmodel/goal-types";

// Lo que la barra envía. `request` es lo que la API recibe hoy; el resto es
// lo que la UI tiene y la API no (se guarda para mostrarlo o avisarlo).
export type BarSubmission = {
  request: AnalysisRequest;
  goalLabel: string;
  model: string;
  profiles: string[];
};

// Acepta "linear.app" o "https://linear.app". Sin esquema, se asume https.
// Válida si es http(s) y el host tiene un punto (o es localhost).
export function normalizeUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname.includes(".") && url.hostname !== "localhost") return null;
    return url.toString();
  } catch {
    return null;
  }
}

// FormData de la barra → envío. Cada control deja su valor en un input
// del formulario: url, goal, mode, profile (uno por perfil) y model.
export function readSubmission(form: HTMLFormElement): BarSubmission | null {
  const data = new FormData(form);
  const url = normalizeUrl(String(data.get("url") ?? ""));
  if (!url) return null;

  // Objetivo: el texto del campo, siempre (un chip solo lo rellena).
  const goal = String(data.get("goal") ?? "").trim();
  if (!goal) return null;
  const personaMode = (data.get("mode") === "personal" ? "personal" : "automatic") as PersonaMode;
  const profiles = data.getAll("profile").map(String);

  return {
    request: {
      url,
      goal,
      personaMode,
      // La API recibe una sola persona: se envía el primer perfil. Los
      // demás no tienen equivalente en el motor todavía.
      customPersona: personaMode === "personal" ? profiles[0] : undefined,
    },
    goalLabel: goal,
    model: String(data.get("model") ?? ""),
    profiles,
  };
}
