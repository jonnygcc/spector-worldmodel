import { PageState } from "./types";
import { Goal, Persona, RouteStep, Route, RouteStepResult } from "./goal-types";
import { RouteEntry } from "./route-finder";
import { describePersonaForPrompt } from "./persona-resolver";
import { sanitizeStep, sanitizeSteps } from "./step-guard";
import { askGemini, cleanJsonResponse } from "../llm/gemini";
import { PROMPTS } from "../llm/prompts";
import { fill } from "../llm/prompt-data";
import { DREAM_SCHEMA, REDREAM_SCHEMA } from "../llm/schemas";

const MAX_STEPS_PER_ROUTE = 6;
const MAX_REDREAM_STEPS = 5;

interface DreamedRoute {
  steps: RouteStep[];
  predictedFriction: number;
  frictionReason: string;
  predictedOutcome: string;
  reachesGoal: boolean;
}

// La página como datos para el modelo (page_data). Primero los elementos
// del contenido (los productos de un listado, el botón de compra) y luego
// los de la cabecera y el pie, que en una página interior suelen ser los
// mismos de siempre.
function pageDataOf(state: PageState) {
  const content = state.interactiveElements.filter((el) => el.region !== "chrome").slice(0, 60);
  const chrome = state.interactiveElements.filter((el) => el.region === "chrome").slice(0, 25);
  return {
    url: state.url,
    title: state.title,
    headings: state.headings.slice(0, 10),
    elements: [...content, ...chrome].map((el) => ({ label: el.label, type: el.type })),
  };
}

// Instrucciones con valores de confianza: objetivo, criterio y perfil.
const trustedValues = (goal: Goal, persona: Persona) => ({
  GOAL_DESCRIPTION: goal.description,
  SUCCESS_CRITERIA: goal.successCriteria,
  PERSONA_DESCRIPTION: describePersonaForPrompt(persona),
});

async function dreamSingleRoute(
  state: PageState,
  goal: Goal,
  persona: Persona,
  entry: RouteEntry
): Promise<DreamedRoute | null> {
  const response = await askGemini({
    system: fill(PROMPTS.dreamRoute, trustedValues(goal, persona)),
    // El primer estado real, con los elementos del contenido primero (como
    // al re-soñar): con los 25 primeros del DOM, casi todos de la cabecera,
    // el plan salía genérico y divergía en el primer paso.
    pageData: {
      ...pageDataOf(state),
      entry: { label: entry.entryPoint, type: entry.entryType, action: entry.entryDescription },
    },
    schema: DREAM_SCHEMA,
  });
  const cleaned = cleanJsonResponse(response);

  try {
    const parsed = JSON.parse(cleaned) as Omit<DreamedRoute, "steps"> & { steps?: unknown };

    // Pasos validados (step-guard): los de tipo, tecla o elemento
    // inválidos se descartan.
    const steps = sanitizeSteps(parsed.steps, MAX_STEPS_PER_ROUTE);

    // Forzamos que el paso 1 use el punto de entrada real
    if (steps.length > 0) {
      steps[0] = { ...steps[0], targetElement: entry.entryPoint, targetType: entry.entryType };
    }

    // El propio sueño dice que la ruta no llega: se descarta, como en el
    // finder. Solo cuando la respuesta se pudo leer; un fallo del modelo
    // no es motivo para tirar la ruta.
    if (parsed.reachesGoal === false) {
      console.log(`[Routes] Discarded "${entry.entryPoint}": the dream predicts it does not reach the goal`);
      return null;
    }

    return {
      steps,
      predictedFriction:
        typeof parsed.predictedFriction === "number" ? parsed.predictedFriction : 0.5,
      frictionReason: parsed.frictionReason || "No reason provided",
      predictedOutcome: parsed.predictedOutcome || "Outcome could not be predicted",
      reachesGoal: parsed.reachesGoal === true,
    };
  } catch {
    const fallback = sanitizeStep(
      {
        type: "click",
        description: entry.entryDescription,
        targetElement: entry.entryPoint,
        targetType: entry.entryType,
      },
      1
    );
    return {
      steps: fallback ? [fallback] : [],
      predictedFriction: 0.5,
      frictionReason: "Prediction engine failed for this route",
      predictedOutcome: "Could not predict the outcome of this route.",
      reachesGoal: false,
    };
  }
}

export async function dreamAllRoutes(
  state: PageState,
  goal: Goal,
  persona: Persona,
  entries: RouteEntry[]
): Promise<Route[]> {
  const routes: Route[] = [];

  for (const entry of entries) {
    console.log(`[Routes] Dreaming route ${entry.id}: "${entry.entryPoint}"...`);
    const dreamed = await dreamSingleRoute(state, goal, persona, entry);
    if (!dreamed || dreamed.steps.length === 0) continue;

    routes.push({
      id: entry.id,
      name: entry.name,
      entryPoint: entry.entryPoint,
      entryDescription: entry.entryDescription,
      howUsersFindIt: entry.howUsersFindIt,
      probability: entry.probability,
      predictedSteps: dreamed.steps,
      predictedFriction: dreamed.predictedFriction,
      frictionReason: dreamed.frictionReason,
      predictedOutcome: dreamed.predictedOutcome,
      verified: false,
    });
  }

  return routes;
}

// ============================================================
// Re-sueño: los pasos restantes desde la página real
// ============================================================
export interface Redream {
  goalAlreadyMet: boolean;
  steps: RouteStep[];
}

// Llama al dreamer con el estado real recién capturado, el objetivo, el
// perfil y los pasos ya ejecutados, y pide solo los pasos que faltan desde
// ahí. Sin pasos y sin objetivo cumplido = no hay camino desde aquí. Los
// pasos hechos y el motivo llevan texto del sitio (títulos, etiquetas):
// van en page_data, no en las instrucciones.
export async function redreamFromState(
  state: PageState,
  goal: Goal,
  persona: Persona,
  done: RouteStepResult[],
  reason: string
): Promise<Redream> {
  const stepsDone = done.map((r, i) => ({
    order: i + 1,
    action: r.step.description,
    target: r.step.targetElement,
    whatHappened: r.whatHappened,
    check: r.check,
  }));

  try {
    const response = await askGemini({
      system: fill(PROMPTS.redreamRoute, trustedValues(goal, persona)),
      pageData: { steps_done: stepsDone, replan_reason: reason, current_page: pageDataOf(state) },
      schema: REDREAM_SCHEMA,
    });
    const parsed = JSON.parse(cleanJsonResponse(response)) as { goalAlreadyMet?: boolean; steps?: unknown };
    return {
      goalAlreadyMet: parsed.goalAlreadyMet === true,
      steps: sanitizeSteps(parsed.steps, MAX_REDREAM_STEPS),
    };
  } catch (error) {
    console.error("[Routes] Re-dream failed:", error);
    return { goalAlreadyMet: false, steps: [] };
  }
}
