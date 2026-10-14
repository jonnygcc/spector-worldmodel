import { PageState, Action, Prediction, JourneyNode } from "./types";
import { askGemini, cleanJsonResponse } from "../llm/gemini";
import { PROMPTS } from "../llm/prompts";

export async function dreamPrediction(
  state: PageState,
  action: Action
): Promise<Prediction> {
  const compactState = {
    url: state.url,
    title: state.title,
    metaDescription: state.metaDescription,
    headings: state.headings,
    interactiveElements: state.interactiveElements.map((el) => ({
      type: el.type,
      label: el.label,
    })),
  };

  const prompt = PROMPTS.dreamState
    .replace("{PAGE_STATE_JSON}", JSON.stringify(compactState, null, 2))
    .replace("{ACTION_JSON}", JSON.stringify(action, null, 2));

  const response = await askGemini(prompt);
  const cleaned = cleanJsonResponse(response);

  try {
    const prediction: Prediction = JSON.parse(cleaned);
    return prediction;
  } catch {
    return {
      actionId: action.id,
      imaginedState: "Could not predict - parsing error",
      predictedFriction: 0.5,
      frictionReason: "Dream engine failed to produce valid prediction",
      extraStepsNeeded: 0,
      confidence: 0.0,
    };
  }
}

export async function buildJourneyTree(
  initialState: PageState,
  actions: Action[]
): Promise<JourneyNode[]> {
  // Nivel 1: predecimos cada accion desde el estado inicial
  const nodes: JourneyNode[] = [];

  for (const action of actions) {
    const prediction = await dreamPrediction(initialState, action);

    nodes.push({
      depth: 0,
      state: initialState,
      action,
      prediction,
      children: [],
    });
  }

  // Ordenamos por friccion predicha descendente
  nodes.sort((a, b) => b.prediction.predictedFriction - a.prediction.predictedFriction);

  return nodes;
}