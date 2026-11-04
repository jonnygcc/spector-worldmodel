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
import { checkDeadline, withAnalysisDeadline, ANALYSIS_TIMEOUT_MS } from "../security/browser-sandbox";
import { mustPropagate } from "../llm/model-errors";

// Derived from the goal only, never from site data. If the call fails there are no signals, and no
// route can come out verified (UNVERIFIED).
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
    // Without quota there's no point going on: the analysis would make a dozen more failing calls.
    if (mustPropagate(error)) throw error;
    console.error("[Spector] Goal signals failed:", error);
    return NO_SIGNALS;
  }
}

// Engine stages in run order; the ids match the UI's StageList.
export type AnalysisStage = "load" | "profiles" | "find" | "simulate" | "browser" | "compare";

// The World Model isn't run here: the UI requests it once the report is on screen, so a slow call
// can't hang the analysis. A total deadline and the request's signal bound everything (browser-sandbox.ts).
export function runGoalAnalysis(
  url: string,
  goalInput: GoalId | Goal,
  personaMode: PersonaMode,
  customPersona?: string,
  onStage?: (stage: AnalysisStage) => void,
  signal?: AbortSignal
): Promise<RouteComparison> {
  return withAnalysisDeadline(
    () =>
      analyze(url, goalInput, personaMode, customPersona, (stage) => {
        // Between stages: stop if the deadline passed or the client left.
        checkDeadline();
        onStage?.(stage);
      }),
    ANALYSIS_TIMEOUT_MS,
    signal
  );
}

async function analyze(
  url: string,
  goalInput: GoalId | Goal,
  personaMode: PersonaMode,
  customPersona: string | undefined,
  onStage: (stage: AnalysisStage) => void
): Promise<RouteComparison> {
  const goal = typeof goalInput === "string" ? GOALS[goalInput] : goalInput;

  console.log(`[Spector] Goal: ${goal.label}`);

  // Load the site before resolving the persona: they're independent, it matches the UI order, and a site
  // that won't load fails in the first stage.
  onStage("load");
  // Before visiting the site, so the page can't influence the signals.
  const goalSignals = await deriveGoalSignals(goal);
  console.log(`[Spector] Goal signals: text [${goalSignals.text.join(", ")}], url [${goalSignals.url.join(", ")}]`);
  console.log("[Spector] Capturing initial state...");
  const { browser, state } = await visitAndCapture(url);
  await browser.close();

  onStage("profiles");
  console.log("[Spector] Resolving persona...");
  const personaSelection = await resolvePersona(personaMode, goal.id, customPersona);
  const persona = personaSelection.resolved;
  console.log(`[Spector] Persona: ${persona.label}`);

  onStage("find");
  console.log("[Spector] Finding routes toward the goal...");
  const { routes: entries, offGoal } = await findRoutes(state, goal, persona);
  console.log(`[Spector] Found ${entries.length} routes.`);

  // Nothing unrelated to the goal runs just to fill the report; if the finder only proposed
  // off-goal routes, the verdict says so.
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

  onStage("simulate");
  console.log("[Spector] Dreaming each route...");
  const routes = await dreamAllRoutes(state, goal, persona, entries);
  if (routes.length === 0) return noPath();

  onStage("browser");
  console.log("[Spector] Verifying top routes in a real browser...");
  return await verifyAndCompare(
    url,
    goal,
    persona,
    personaSelection.mode,
    state,
    routes,
    goalSignals,
    () => onStage("compare")
  );
}
