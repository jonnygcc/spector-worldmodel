import { PageState, InteractiveElement } from "./types";
import { Goal, Persona } from "./goal-types";
import { askGemini, cleanJsonResponse } from "../llm/gemini";
import { PROMPTS } from "../llm/prompts";
import { fill } from "../llm/prompt-data";
import { ROUTES_SCHEMA } from "../llm/schemas";

export interface RouteEntry {
  id: string;
  // Nombre de la ruta en inglés, para mostrar. entryPoint es la etiqueta
  // literal del elemento (en el idioma del sitio) y sirve para encontrarlo.
  name?: string;
  entryPoint: string;
  entryType: InteractiveElement["type"];
  entryDescription: string;
  howUsersFindIt: string;
  // Dónde termina la ruta y si eso cumple el criterio de éxito. Las que
  // no lo cumplen se descartan.
  endState?: string;
  meetsCriteria?: boolean;
  // Cómo lleva al objetivo y si de verdad lo sirve. Las que no (una
  // búsqueda cuando el objetivo es iniciar sesión) se descartan antes de
  // ejecutar nada.
  goalLink?: string;
  servesGoal?: boolean;
  probability: number;
}

// Resultado del finder: las rutas válidas y las candidatas que se
// descartaron por no servir al objetivo (para explicar un resultado vacío).
export interface RouteSearch {
  routes: RouteEntry[];
  offGoal: string[];
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
): Promise<RouteSearch> {
  const elements = state.interactiveElements.slice(0, 30);

  // Instrucciones con el objetivo y el perfil; la página, como datos.
  const request = {
    system: fill(PROMPTS.findRoutes, {
      GOAL_DESCRIPTION: goal.description,
      SUCCESS_CRITERIA: goal.successCriteria,
      PERSONA_DESCRIPTION: buildPersonaDescription(persona),
      GOAL_LABEL: goal.label,
    }),
    pageData: {
      url: state.url,
      title: state.title,
      headings: state.headings.slice(0, 10),
      elements: elements.map((el) => ({ label: el.label, type: el.type })),
    },
    schema: ROUTES_SCHEMA,
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await askGemini(request);
    const cleaned = cleanJsonResponse(response);

    try {
      const parsed = JSON.parse(cleaned) as RouteEntry[];

      if (!Array.isArray(parsed)) {
        continue;
      }

      // Solo rutas que sirven al objetivo y terminan cumpliendo el criterio
      // de éxito; sin servesGoal explícito, tampoco. Una lista vacía es un
      // resultado válido: no hay camino al objetivo, y no se rellena con
      // rutas ajenas.
      const offGoal: string[] = [];
      const raw = parsed.filter((route) => {
        if (route.servesGoal !== true) {
          offGoal.push(route.name || route.entryPoint);
          console.log(`[Routes] Discarded "${route.entryPoint}": unrelated to the goal (${route.goalLink ?? "no goal link"})`);
          return false;
        }
        if (route.meetsCriteria === true) return true;
        console.log(`[Routes] Discarded "${route.entryPoint}": does not meet the success criteria (${route.endState ?? "no end state"})`);
        return false;
      });
      if (raw.length === 0) return { routes: [], offGoal };

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
        return { routes: [], offGoal };
      }

      return {
        routes: unique.sort((a, b) => (b.probability || 0) - (a.probability || 0)).slice(0, MAX_ROUTES),
        offGoal,
      };
    } catch {
    }
  }

  return { routes: [], offGoal: [] };
}