import { visitAndCapture } from "./capture";
import { findRoutes } from "./route-finder";
import { dreamAllRoutes } from "./route-dreamer";
import { verifyAndCompare } from "./route-verifier";
import { resolvePersona } from "./persona-resolver";
import { GOALS, Goal, GoalId, PersonaMode, RouteComparison } from "./goal-types";
import { GoalSignals, NO_SIGNALS, normalizeSignals } from "./goal-evidence";
import { askGemini, cleanJsonResponse } from "../llm/gemini";
import { PROMPTS } from "../llm/prompts";
import { fill } from "../llm/prompt-data";
import { GOAL_SIGNALS_SCHEMA } from "../llm/schemas";

// Señales de que el objetivo se cumplió, pedidas solo a partir del
// objetivo: sin datos del sitio. Si la llamada falla no hay señales, y
// ninguna ruta podrá salir como verificada (queda UNVERIFIED).
async function deriveGoalSignals(goal: Goal): Promise<GoalSignals> {
  try {
    const response = await askGemini({
      system: fill(PROMPTS.goalSignals, {
        GOAL_DESCRIPTION: goal.description,
        SUCCESS_CRITERIA: goal.successCriteria,
      }),
      schema: GOAL_SIGNALS_SCHEMA,
    });
    return normalizeSignals(JSON.parse(cleanJsonResponse(response)));
  } catch (error) {
    console.error("[Spector] Goal signals failed:", error);
    return NO_SIGNALS;
  }
}

// Etapas del motor, en el orden en que corren. Los ids son los del
// StageList de la UI (components/loading/StageList.tsx).
export type AnalysisStage = "load" | "profiles" | "find" | "simulate" | "browser" | "compare";

// `goalInput`: un objetivo de la lista (GoalId, lo que envía /api/goal)
// o uno ya construido, como el que escribe el usuario (goalFromText).
// El World Model no corre aquí: lo pide la UI aparte (/api/world-model)
// cuando el reporte del agente ya está en pantalla, para que una llamada
// lenta o limitada no deje el análisis colgado en "Comparing routes…".
export async function runGoalAnalysis(
  url: string,
  goalInput: GoalId | Goal,
  personaMode: PersonaMode,
  customPersona?: string,
  onStage?: (stage: AnalysisStage) => void
): Promise<RouteComparison> {
  const goal = typeof goalInput === "string" ? GOALS[goalInput] : goalInput;

  console.log(`[Spector] Goal: ${goal.label}`);

  // Se carga el sitio antes de resolver la persona (antes iba al revés):
  // no dependen entre sí, y así el orden coincide con el de la UI y un
  // sitio que no carga falla en la primera etapa.
  onStage?.("load");
  // Antes de visitar el sitio: la página no puede influir en las señales.
  const goalSignals = await deriveGoalSignals(goal);
  console.log(`[Spector] Goal signals: text [${goalSignals.text.join(", ")}], url [${goalSignals.url.join(", ")}]`);
  console.log("[Spector] Capturing initial state...");
  const { browser, state } = await visitAndCapture(url);
  await browser.close();

  onStage?.("profiles");
  console.log("[Spector] Resolving persona...");
  const personaSelection = await resolvePersona(personaMode, goal.id, customPersona);
  const persona = personaSelection.resolved;
  console.log(`[Spector] Persona: ${persona.label}`);

  onStage?.("find");
  console.log("[Spector] Finding routes toward the goal...");
  const { routes: entries, offGoal } = await findRoutes(state, goal, persona);
  console.log(`[Spector] Found ${entries.length} routes.`);

  // Sin rutas que terminen cumpliendo el criterio de éxito (las descarta
  // el finder, o el dreamer al soñarlas): no hay camino al objetivo. No se
  // ejecuta nada ajeno al objetivo para llenar el reporte: si el finder
  // solo propuso rutas que no servían al objetivo, el veredicto lo dice.
  const offGoalNote =
    offGoal.length > 0
      ? ` The only candidates were unrelated to "${goal.label}" (${offGoal.map((n) => `"${n}"`).join(", ")}), so they were not run.`
      : "";
  const noPath = (): RouteComparison => ({
    url,
    goal,
    persona,
    personaMode: personaSelection.mode,
    initialState: state,
    routes: [],
    routesFound: 0,
    goalSignals,
    bestRouteId: null,
    mostLikelyRouteId: null,
    verdict:
      `Unreachable: Spector couldn't find any clear path toward this goal on the page.${offGoalNote} That may itself be the problem: the action has no visible entry point.`,
    recommendation:
      "Add a visible, clearly labeled entry point for this goal on the landing page.",
  });

  if (entries.length === 0) return noPath();

  onStage?.("simulate");
  console.log("[Spector] Dreaming each route...");
  const routes = await dreamAllRoutes(state, goal, persona, entries);
  if (routes.length === 0) return noPath();

  onStage?.("browser");
  console.log("[Spector] Verifying top routes in a real browser...");
  return await verifyAndCompare(
    url,
    goal,
    persona,
    personaSelection.mode,
    state,
    routes,
    goalSignals,
    () => onStage?.("compare")
  );
}
