import { PageState } from "./types";
import { Goal, Persona, RouteStep, Route, RouteStepResult, NavigationExpectation } from "./goal-types";
import { RouteEntry } from "./route-finder";
import { describePersonaForPrompt } from "./persona-resolver";
import { askGemini, cleanJsonResponse } from "../llm/gemini";
import { PROMPTS } from "../llm/prompts";

const MAX_STEPS_PER_ROUTE = 6;
const MAX_REDREAM_STEPS = 5;

interface DreamedRoute {
  steps: RouteStep[];
  predictedFriction: number;
  frictionReason: string;
  predictedOutcome: string;
  reachesGoal: boolean;
}

function pageContextOf(state: PageState): string {
  return JSON.stringify(
    {
      url: state.url,
      title: state.title,
      metaDescription: state.metaDescription,
      headings: state.headings.slice(0, 10),
    },
    null,
    2
  );
}

// Para re-soñar: primero los elementos del contenido de la página (los
// productos de un listado, el botón de compra) y luego los de la cabecera
// y el pie, que en una página interior suelen ser los mismos de siempre.
function contentFirstLabels(state: PageState): string {
  const content = state.interactiveElements.filter((el) => el.region !== "chrome").slice(0, 60);
  const chrome = state.interactiveElements.filter((el) => el.region === "chrome").slice(0, 25);
  return [...content, ...chrome].map((el) => `- "${el.label}" (${el.type})`).join("\n");
}

// Deja cada paso con su expectativa verificable en forma válida: el
// modelo a veces omite campos o devuelve tipos raros.
function normalizeStep(raw: Partial<RouteStep>, order: number): RouteStep {
  const nav: NavigationExpectation =
    raw.navigationExpected === "navigate" || raw.navigationExpected === "same-page"
      ? raw.navigationExpected
      : "unknown";
  const hint =
    typeof raw.expectedUrlHint === "string" && raw.expectedUrlHint.trim()
      ? raw.expectedUrlHint.trim()
      : null;
  const signals = Array.isArray(raw.expectedSignals)
    ? raw.expectedSignals.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim()).slice(0, 3)
    : [];
  return {
    order,
    type: raw.type ?? "click",
    description: raw.description ?? "",
    targetElement: raw.targetElement ?? "",
    targetType: raw.targetType ?? "button",
    value: raw.value,
    navigationExpected: nav,
    expectedUrlHint: hint,
    expectedSignals: signals,
  };
}

async function dreamSingleRoute(
  state: PageState,
  goal: Goal,
  persona: Persona,
  entry: RouteEntry
): Promise<DreamedRoute | null> {
  const prompt = PROMPTS.dreamRoute
    .replace("{GOAL_DESCRIPTION}", goal.description)
    .replace("{SUCCESS_CRITERIA}", goal.successCriteria)
    .replace("{PERSONA_DESCRIPTION}", describePersonaForPrompt(persona))
    .replace("{PAGE_CONTEXT}", pageContextOf(state))
    // El primer estado real, con los elementos del contenido primero (como
    // al re-soñar): con los 25 primeros del DOM, casi todos de la cabecera,
    // el plan salía genérico y divergía en el primer paso.
    .replace("{ELEMENT_LABELS}", contentFirstLabels(state))
    .replace("{ENTRY_POINT}", entry.entryPoint)
    .replace("{ENTRY_TYPE}", entry.entryType)
    .replace("{ENTRY_DESCRIPTION}", entry.entryDescription);

  const response = await askGemini(prompt);
  const cleaned = cleanJsonResponse(response);

  try {
    const parsed = JSON.parse(cleaned) as DreamedRoute;

    const steps = (Array.isArray(parsed.steps) ? parsed.steps : [])
      .slice(0, MAX_STEPS_PER_ROUTE)
      .map((step, i) => normalizeStep(step, i + 1));

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
    return {
      steps: [
        normalizeStep(
          {
            type: "click",
            description: entry.entryDescription,
            targetElement: entry.entryPoint,
            targetType: entry.entryType,
          },
          1
        ),
      ],
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
    if (!dreamed) continue;

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
// ahí. Sin pasos y sin objetivo cumplido = no hay camino desde aquí.
export async function redreamFromState(
  state: PageState,
  goal: Goal,
  persona: Persona,
  done: RouteStepResult[],
  reason: string
): Promise<Redream> {
  const executed =
    done.length === 0
      ? "(none yet)"
      : done
          .map(
            (r, i) =>
              `${i + 1}. ${r.step.description} — target "${r.step.targetElement}" — ${r.whatHappened} (check: ${r.check})`
          )
          .join("\n");

  const prompt = PROMPTS.redreamRoute
    .replace("{GOAL_DESCRIPTION}", goal.description)
    .replace("{SUCCESS_CRITERIA}", goal.successCriteria)
    .replace("{PERSONA_DESCRIPTION}", describePersonaForPrompt(persona))
    .replace("{EXECUTED_STEPS}", executed)
    .replace("{REASON}", reason)
    .replace("{PAGE_CONTEXT}", pageContextOf(state))
    .replace("{ELEMENT_LABELS}", contentFirstLabels(state));

  try {
    const response = await askGemini(prompt);
    const parsed = JSON.parse(cleanJsonResponse(response)) as {
      goalAlreadyMet?: boolean;
      steps?: Partial<RouteStep>[];
    };
    const steps = (Array.isArray(parsed.steps) ? parsed.steps : [])
      .slice(0, MAX_REDREAM_STEPS)
      .map((step, i) => normalizeStep(step, i + 1));
    return { goalAlreadyMet: parsed.goalAlreadyMet === true, steps };
  } catch (error) {
    console.error("[Routes] Re-dream failed:", error);
    return { goalAlreadyMet: false, steps: [] };
  }
}
