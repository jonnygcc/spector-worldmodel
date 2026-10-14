import { PageState, InteractiveElement } from "./types";
import { Goal, Persona } from "./goal-types";
import { askGemini, cleanJsonResponse } from "../llm/gemini";
import { PROMPTS } from "../llm/prompts";

export interface RouteEntry {
  id: string;
  entryPoint: string;
  entryType: InteractiveElement["type"];
  entryDescription: string;
  howUsersFindIt: string;
  probability: number;
}

const MAX_ROUTES = 5;

function buildPersonaDescription(persona: Persona): string {
  const traits = persona.traits.length > 0 ? ` Traits: ${persona.traits.join(", ")}.` : "";
  return `${persona.label} — ${persona.description}${traits} Patience: ${persona.patience}. Tech savvy: ${persona.techSavvy}.`;
}

export async function findRoutes(
  state: PageState,
  goal: Goal,
  persona: Persona,
  maxAttempts = 2
): Promise<RouteEntry[]> {
  const elements = state.interactiveElements.slice(0, 30);

  const elementLabels = elements
    .map((el) => `- "${el.label}" (${el.type})`)
    .join("\n");

  const pageContext = JSON.stringify(
    {
      url: state.url,
      title: state.title,
      metaDescription: state.metaDescription,
      headings: state.headings.slice(0, 10),
    },
    null,
    2
  );

  const prompt = PROMPTS.findRoutes
    .replace("{GOAL_DESCRIPTION}", goal.description)
    .replace("{SUCCESS_CRITERIA}", goal.successCriteria)
    .replace("{PERSONA_DESCRIPTION}", buildPersonaDescription(persona))
    .replace("{ELEMENT_LABELS}", elementLabels)
    .replace("{PAGE_CONTEXT}", pageContext);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await askGemini(prompt);
    const cleaned = cleanJsonResponse(response);

    try {
      const raw = JSON.parse(cleaned) as RouteEntry[];

      if (!Array.isArray(raw) || raw.length === 0) {
        continue;
      }

      const validLabels = new Map(
        elements.map((el) => [el.label.toLowerCase(), el.label])
      );

      const fixed = raw.map((route) => {
        const key = (route.entryPoint || "").toLowerCase();
        if (validLabels.has(key)) return route;

        let best: { label: string; score: number } | null = null;
        for (const el of elements) {
          if (el.type !== route.entryType) continue;
          const a = el.label.toLowerCase();
          let score = 0;
          if (a === key) score = 100;
          else if (a.includes(key) || key.includes(a)) {
            score = 60 - Math.abs(a.length - key.length);
          }
          if (score > 0 && (!best || score > best.score)) {
            best = { label: el.label, score };
          }
        }

        if (best) return { ...route, entryPoint: best.label };
        return route;
      });

      const seen = new Set<string>();
      const unique = fixed.filter((r) => {
        const key = (r.entryPoint || "").toLowerCase();
        if (!key) return false;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      if (unique.length === 0) {
        continue;
      }

      return unique
        .sort((a, b) => (b.probability || 0) - (a.probability || 0))
        .slice(0, MAX_ROUTES);
    } catch (err) {
    }
  }

  return [];
}