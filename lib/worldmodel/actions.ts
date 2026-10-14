import { PageState, Action } from "./types";
import { askGemini, cleanJsonResponse } from "../llm/gemini";
import { PROMPTS } from "../llm/prompts";

export async function generateActionSpace(state: PageState): Promise<Action[]> {
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

  const prompt = PROMPTS.generateActions.replace(
    "{PAGE_STATE_JSON}",
    JSON.stringify(compactState, null, 2)
  );

  const response = await askGemini(prompt);
  const cleaned = cleanJsonResponse(response);

  try {
    const actions: Action[] = JSON.parse(cleaned);
    return actions;
  } catch {
    return [];
  }
}