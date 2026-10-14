import { PageState, StepAction, UserProfile } from "./types";
import { askGemini, cleanJsonResponse } from "../llm/gemini";
import { PROMPTS } from "../llm/prompts";

export interface ParsedScenario {
  intent: string;
  userProfile: UserProfile;
  steps: StepAction[];
  truncated: boolean;
}

const MAX_STEPS = 4;

export async function parseWhatIfQuestion(
  state: PageState,
  question: string
): Promise<ParsedScenario> {
  const elements = state.interactiveElements.slice(0, 25);

  const elementLabels = elements
    .map((el) => `- "${el.label}" (${el.type})`)
    .join("\n");

  const compactState = {
    url: state.url,
    title: state.title,
    headings: state.headings.slice(0, 8),
  };

  const prompt = PROMPTS.parseWhatIf
    .replace("{ELEMENT_LABELS}", elementLabels)
    .replace("{PAGE_STATE_JSON}", JSON.stringify(compactState, null, 2))
    .replace("{QUESTION}", question);

  const response = await askGemini(prompt);
  const cleaned = cleanJsonResponse(response);

  try {
    const parsed = JSON.parse(cleaned) as {
      intent: string;
      userProfile: UserProfile;
      steps: StepAction[];
    };

    const validLabels = new Set(elements.map((el) => el.label.toLowerCase()));

    // Corregimos targets invalidos buscando el mas parecido
    const fixedSteps = parsed.steps.map((step) => {
      if (step.type === "scroll") return step;

      const target = step.targetElement?.toLowerCase() || "";
      if (validLabels.has(target)) return step;

      // Buscamos el elemento mas parecido entre los disponibles
      let best: { label: string; score: number } | null = null;

      for (const el of elements) {
        if (el.type !== step.targetType) continue;
        const a = el.label.toLowerCase();
        let score = 0;
        if (target.includes(a) || a.includes(target)) {
          score = 60 - Math.abs(a.length - target.length);
        }
        if (score > 0 && (!best || score > best.score)) {
          best = { label: el.label, score };
        }
      }

      if (best) {
        return { ...step, targetElement: best.label };
      }
      return step;
    });

    const truncated = fixedSteps.length > MAX_STEPS;

    return {
      intent: parsed.intent,
      userProfile: parsed.userProfile || "new",
      steps: fixedSteps.slice(0, MAX_STEPS),
      truncated,
    };
  } catch {
    return {
      intent: question,
      userProfile: "new",
      steps: [],
      truncated: false,
    };
  }
}