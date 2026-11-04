import { PageState } from "./types";
import { Goal, Persona, RouteStep, Route, RouteStepResult } from "./goal-types";
import { RouteEntry } from "./route-finder";
import { describePersonaForPrompt } from "./persona-resolver";
import { sanitizeStep, sanitizeSteps } from "./step-guard";
import { askGemini, cleanJsonResponse } from "../llm/gemini";
import { PROMPTS } from "../llm/prompts";
import { fill } from "../llm/prompt-data";
import { DREAM_SCHEMA, REDREAM_SCHEMA } from "../llm/schemas";
import { mustPropagate } from "../llm/model-errors";

const MAX_STEPS_PER_ROUTE = 6;
const MAX_REDREAM_STEPS = 5;

interface DreamedRoute {
  steps: RouteStep[];
  predictedFriction: number;
  frictionReason: string;
  predictedOutcome: string;
  reachesGoal: boolean;
}

// Content elements first (a listing's products, the buy button), then header and footer, which on
// inner pages are the same everywhere.
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

// Instructions take trusted values only: goal, criteria and profile.
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
    // Content first, as when re-planning: with the DOM's first 25 elements, mostly header, the plan came out
    // generic and diverged on step 1.
    pageData: {
      ...pageDataOf(state),
      entry: { label: entry.entryPoint, type: entry.entryType, action: entry.entryDescription },
    },
    schema: DREAM_SCHEMA,
  });
  const cleaned = cleanJsonResponse(response);

  try {
    const parsed = JSON.parse(cleaned) as Omit<DreamedRoute, "steps"> & { steps?: unknown };

    // Steps with an invalid type, key or element are dropped (step-guard).
    const steps = sanitizeSteps(parsed.steps, MAX_STEPS_PER_ROUTE);

    // Step 1 must use the real entry point.
    if (steps.length > 0) {
      steps[0] = { ...steps[0], targetElement: entry.entryPoint, targetType: entry.entryType };
    }

    // The dream itself says the route doesn't arrive: dropped, like in the finder. Only when the answer
    // could be read; a model failure is no reason to drop the route.
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

// ---- Re-plan: the remaining steps from the real page ----
export interface Redream {
  goalAlreadyMet: boolean;
  steps: RouteStep[];
}

// No steps and goal not met means no path from here. Steps done and the reason carry site text
// (titles, labels), so they go in page_data, not in the instructions.
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
    // Quota, deadline or disconnect aren't "no path": they propagate.
    if (mustPropagate(error)) throw error;
    console.error("[Routes] Re-dream failed:", error);
    return { goalAlreadyMet: false, steps: [] };
  }
}
