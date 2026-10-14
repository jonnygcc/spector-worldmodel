import { PageState } from "./types";
import { Goal, Persona, RouteStep, Route } from "./goal-types";
import { RouteEntry } from "./route-finder";
import { describePersonaForPrompt } from "./persona-resolver";
import { askGemini, cleanJsonResponse } from "../llm/gemini";
import { PROMPTS } from "../llm/prompts";

const MAX_STEPS_PER_ROUTE = 4;

interface DreamedRoute {
  steps: RouteStep[];
  predictedFriction: number;
  frictionReason: string;
  predictedOutcome: string;
  reachesGoal: boolean;
}

async function dreamSingleRoute(
  state: PageState,
  goal: Goal,
  persona: Persona,
  entry: RouteEntry
): Promise<DreamedRoute> {
  const elements = state.interactiveElements.slice(0, 25);
  const elementLabels = elements.map((el) => `- "${el.label}" (${el.type})`).join("\n");

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

  const prompt = PROMPTS.dreamRoute
    .replace("{GOAL_DESCRIPTION}", goal.description)
    .replace("{SUCCESS_CRITERIA}", goal.successCriteria)
    .replace("{PERSONA_DESCRIPTION}", describePersonaForPrompt(persona))
    .replace("{PAGE_CONTEXT}", pageContext)
    .replace("{ELEMENT_LABELS}", elementLabels)
    .replace("{ENTRY_POINT}", entry.entryPoint)
    .replace("{ENTRY_TYPE}", entry.entryType)
    .replace("{ENTRY_DESCRIPTION}", entry.entryDescription);

  const response = await askGemini(prompt);
  const cleaned = cleanJsonResponse(response);

  try {
    const parsed = JSON.parse(cleaned) as DreamedRoute;

    const steps = Array.isArray(parsed.steps)
      ? parsed.steps.slice(0, MAX_STEPS_PER_ROUTE)
      : [];

    // Forzamos que el paso 1 use el punto de entrada real
    if (steps.length > 0) {
      steps[0] = {
        ...steps[0],
        order: 1,
        targetElement: entry.entryPoint,
        targetType: entry.entryType,
      };
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
        {
          order: 1,
          type: "click",
          description: entry.entryDescription,
          targetElement: entry.entryPoint,
          targetType: entry.entryType,
        },
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

    routes.push({
      id: entry.id,
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