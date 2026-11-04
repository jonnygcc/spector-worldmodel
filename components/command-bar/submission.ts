import type { AnalysisRequest } from "@/lib/worldmodel/analysis-events";
import type { PersonaMode } from "@/lib/worldmodel/goal-types";

// `request` is what the API receives; the rest is UI-only, kept to display or warn.
export type BarSubmission = {
  request: AnalysisRequest;
  goalLabel: string;
  model: string;
  profiles: string[];
};

// Without a scheme, https is assumed. Valid if http(s) and the host has a dot (or is localhost).
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

// Each control leaves its value in a form input: url, goal, mode, profile (one per profile), model.
export function readSubmission(form: HTMLFormElement): BarSubmission | null {
  const data = new FormData(form);
  const url = normalizeUrl(String(data.get("url") ?? ""));
  if (!url) return null;

  // Always the field's text: a chip only fills it in.
  const goal = String(data.get("goal") ?? "").trim();
  if (!goal) return null;
  const personaMode = (data.get("mode") === "personal" ? "personal" : "automatic") as PersonaMode;
  const profiles = data.getAll("profile").map(String);

  return {
    request: {
      url,
      goal,
      personaMode,
      // The API takes a single persona: the other profiles have no engine equivalent yet.
      customPersona: personaMode === "personal" ? profiles[0] : undefined,
    },
    goalLabel: goal,
    model: String(data.get("model") ?? ""),
    profiles,
  };
}
