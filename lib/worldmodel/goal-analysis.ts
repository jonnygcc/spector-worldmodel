import { visitAndCapture } from "./capture";
import { findRoutes } from "./route-finder";
import { dreamAllRoutes } from "./route-dreamer";
import { verifyAndCompare } from "./route-verifier";
import { resolvePersona } from "./persona-resolver";
import { GOALS, GoalId, PersonaMode, RouteComparison } from "./goal-types";

export async function runGoalAnalysis(
  url: string,
  goalId: GoalId,
  personaMode: PersonaMode,
  customPersona?: string
): Promise<RouteComparison> {
  const goal = GOALS[goalId];

  console.log(`[Spector] Goal: ${goal.label}`);

  console.log("[Spector] Resolving persona...");
  const personaSelection = await resolvePersona(personaMode, goalId, customPersona);
  const persona = personaSelection.resolved;
  console.log(`[Spector] Persona: ${persona.label}`);

  console.log("[Spector] Capturing initial state...");
  const { browser, state } = await visitAndCapture(url);
  await browser.close();

  console.log("[Spector] Finding routes toward the goal...");
  const entries = await findRoutes(state, goal, persona);
  console.log(`[Spector] Found ${entries.length} routes.`);

  if (entries.length === 0) {
    return {
      url,
      goal,
      persona,
      personaMode: personaSelection.mode,
      initialState: state,
      routes: [],
      bestRouteId: null,
      mostLikelyRouteId: null,
      verdict:
        "Spector couldn't find any clear path toward this goal on the page. That may itself be the problem: the action has no visible entry point.",
      recommendation:
        "Add a visible, clearly labeled entry point for this goal on the landing page.",
    };
  }

  console.log("[Spector] Dreaming each route...");
  const routes = await dreamAllRoutes(state, goal, persona, entries);

  console.log("[Spector] Verifying top routes in a real browser...");
  return await verifyAndCompare(
    url,
    goal,
    persona,
    personaSelection.mode,
    state,
    routes
  );
}