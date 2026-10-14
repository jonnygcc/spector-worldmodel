import { Page } from "playwright-core";
import { captureState, retagAndFindElement, launchBrowser } from "./capture";
import {
  PageState,
  StepAction,
  StepPrediction,
  StepVerification,
  WhatIfStep,
  WhatIfJourney,
  UserProfile,
} from "./types";
import { askGemini, cleanJsonResponse } from "../llm/gemini";
import { PROMPTS } from "../llm/prompts";
import { parseWhatIfQuestion } from "./whatif-parser";

// ============================================================
// DREAM: predice el resultado de un paso
// ============================================================
async function dreamStep(
  state: PageState,
  action: StepAction,
  intent: string,
  userProfile: UserProfile,
  previousSteps: string[]
): Promise<StepPrediction> {
  const compactState = {
    url: state.url,
    title: state.title,
    headings: state.headings.slice(0, 8),
    interactiveElements: state.interactiveElements.slice(0, 15).map((el) => ({
      type: el.type,
      label: el.label,
    })),
  };

  const prompt = PROMPTS.dreamStep
    .replace("{INTENT}", intent)
    .replace("{USER_PROFILE}", userProfile)
    .replace(
      "{PREVIOUS_STEPS}",
      previousSteps.length > 0 ? previousSteps.join(" -> ") : "none, this is the first step"
    )
    .replace("{PAGE_STATE_JSON}", JSON.stringify(compactState, null, 2))
    .replace("{ACTION_JSON}", JSON.stringify(action, null, 2));

  const response = await askGemini(prompt);
  const cleaned = cleanJsonResponse(response);

  try {
    return JSON.parse(cleaned) as StepPrediction;
  } catch {
    return {
      imaginedState: "Could not generate prediction for this step.",
      predictedFriction: 0.5,
      frictionReason: "Prediction engine failed",
      confidence: 0,
    };
  }
}

// ============================================================
// EXECUTE: ejecuta un paso en la pagina actual
// ============================================================
interface StepOutcome {
  executed: boolean;
  stateChanged: boolean;
  failReason?: string;
}

async function executeStep(page: Page, action: StepAction): Promise<StepOutcome> {
  const urlBefore = page.url();
  const bodyBefore = (await page
    .evaluate("document.body.innerText.substring(0, 3000)")
    .catch(() => "")) as string;

  try {
    if (action.type === "scroll") {
      await page.evaluate("window.scrollBy(0, window.innerHeight)");
      await page.waitForTimeout(1200);
      return { executed: true, stateChanged: true };
    }

    if (action.type === "press") {
      await page.keyboard.press(action.value || "Enter");
      await page.waitForTimeout(2200);
    } else {
      const selector = await retagAndFindElement(page, action.targetElement, action.targetType);

      console.log(
        `   [exec] looking for: "${action.targetElement}" (${action.targetType}) -> selector: ${selector ?? "NOT FOUND"}`
      );

      if (!selector) {
        return {
          executed: false,
          stateChanged: false,
          failReason: `no element matched label "${action.targetElement}" of type ${action.targetType}`,
        };
      }

      const element = page.locator(selector).first();
      await element.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});

      if (action.type === "click") {
        await element.click({ timeout: 6000 });
      } else if (action.type === "type") {
        await element.click({ timeout: 6000 }).catch(() => {});
        await element.fill(action.value || "", { timeout: 6000 });
      }
    }
  } catch (err) {
    console.log(`   [exec] error: ${(err as Error).message.split("\n")[0]}`);
    return {
      executed: false,
      stateChanged: false,
      failReason: (err as Error).message.split("\n")[0],
    };
  }

  // Esperamos navegacion si la hay
  try {
    await page.waitForURL((u) => u.toString() !== urlBefore, { timeout: 5000 });
    await page.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(1200);
    return { executed: true, stateChanged: true };
  } catch {
    // no hubo navegacion
  }

  await page.waitForTimeout(1500);

  if (page.url() !== urlBefore) {
    await page.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => {});
    return { executed: true, stateChanged: true };
  }

  const bodyAfter = (await page
    .evaluate("document.body.innerText.substring(0, 3000)")
    .catch(() => "")) as string;

  const changed = bodyBefore !== bodyAfter;

  if (action.type === "type") {
    return { executed: true, stateChanged: true };
  }

  return { executed: true, stateChanged: changed };
}

// ============================================================
// COMPARE: compara prediccion vs realidad para un paso
// ============================================================
async function compareStep(
  prediction: StepPrediction,
  actualState: PageState,
  outcome: StepOutcome
): Promise<{ predictionMatch: number; realFriction: number; discrepancy: string }> {
  if (!outcome.executed) {
    return {
      predictionMatch: 0,
      realFriction: 1,
      discrepancy: `execution_error: ${outcome.failReason || "the element could not be found or interacted with"}`,
    };
  }

  if (!outcome.stateChanged) {
    return {
      predictionMatch: 0.2,
      realFriction: 0.7,
      discrepancy: "The action was performed but the page did not respond in any visible way.",
    };
  }

  const prompt = PROMPTS.compareStep
    .replace(
      "{PREDICTION_JSON}",
      JSON.stringify(
        {
          imaginedState: prediction.imaginedState,
          predictedFriction: prediction.predictedFriction,
        },
        null,
        2
      )
    )
    .replace(
      "{ACTUAL_JSON}",
      JSON.stringify(
        {
          url: actualState.url,
          title: actualState.title,
          headings: actualState.headings.slice(0, 8),
          interactiveElements: actualState.interactiveElements.slice(0, 10).map((el) => ({
            type: el.type,
            label: el.label,
          })),
        },
        null,
        2
      )
    );

  const response = await askGemini(prompt);
  const cleaned = cleanJsonResponse(response);

  try {
    return JSON.parse(cleaned) as {
      predictionMatch: number;
      realFriction: number;
      discrepancy: string;
    };
  } catch {
    return {
      predictionMatch: 0.5,
      realFriction: prediction.predictedFriction,
      discrepancy: "match",
    };
  }
}

// ============================================================
// SUMMARIZE: narra el journey completo
// ============================================================
async function summarizeJourney(
  intent: string,
  userProfile: UserProfile,
  steps: WhatIfStep[]
): Promise<{ outcome: "completed" | "blocked" | "partial"; summary: string }> {
  const compact = steps.map((s) => ({
    step: s.action.description,
    predicted: s.prediction.imaginedState.substring(0, 200),
    executed: s.verification?.executed ?? false,
    realFriction: s.verification?.realFriction ?? 0,
    whatHappened: s.verification?.discrepancy ?? "not executed",
  }));

  const prompt = PROMPTS.summarizeWhatIf
    .replace("{INTENT}", intent)
    .replace("{USER_PROFILE}", userProfile)
    .replace("{STEPS_JSON}", JSON.stringify(compact, null, 2));

  const response = await askGemini(prompt);
  const cleaned = cleanJsonResponse(response);

  try {
    return JSON.parse(cleaned) as {
      outcome: "completed" | "blocked" | "partial";
      summary: string;
    };
  } catch {
    return {
      outcome: "partial",
      summary: "The journey was simulated but a summary could not be generated.",
    };
  }
}

// ============================================================
// ORCHESTRATOR: corre el journey what-if completo
// ============================================================
export async function runWhatIf(url: string, question: string): Promise<WhatIfJourney> {
  const browser = await launchBrowser();
  const page = await browser.newPage();

  try {
    console.log("[WhatIf] Loading page...");
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(1200);

    let currentState = await captureState(page);

    console.log("[WhatIf] Parsing question into steps...");
    const parsed = await parseWhatIfQuestion(currentState, question);

    // ---- LOGS DE DIAGNOSTICO ----
    console.log("\n[DEBUG] Parsed steps:");
    console.log(JSON.stringify(parsed.steps, null, 2));
    console.log("\n[DEBUG] Available elements on page:");
    console.log(
      JSON.stringify(
        currentState.interactiveElements.slice(0, 25).map((el) => ({
          label: el.label,
          type: el.type,
        })),
        null,
        2
      )
    );
    console.log("");
    // ------------------------------

    if (parsed.steps.length === 0) {
      return {
        url,
        question,
        intent: parsed.intent,
        userProfile: parsed.userProfile,
        steps: [],
        outcome: "blocked",
        summary:
          "Spector couldn't turn this question into actions it can perform on the page. Try phrasing it around a specific element you can see on the site.",
        truncated: false,
      };
    }

    const steps: WhatIfStep[] = [];
    const previousDescriptions: string[] = [];

    for (const action of parsed.steps) {
      console.log(`[WhatIf] Step ${action.order}: dreaming...`);
      const prediction = await dreamStep(
        currentState,
        action,
        parsed.intent,
        parsed.userProfile,
        previousDescriptions
      );

      console.log(`[WhatIf] Step ${action.order}: executing...`);
      const outcome = await executeStep(page, action);

      const actualState = await captureState(page);

      console.log(`[WhatIf] Step ${action.order}: comparing...`);
      const comparison = await compareStep(prediction, actualState, outcome);

      const verification: StepVerification = {
        executed: outcome.executed,
        stateChanged: outcome.stateChanged,
        actualUrl: actualState.url,
        actualTitle: actualState.title,
        screenshot: actualState.screenshot,
        predictionMatch: comparison.predictionMatch,
        realFriction: comparison.realFriction,
        discrepancy: comparison.discrepancy,
      };

      steps.push({ action, prediction, verification });
      previousDescriptions.push(action.description);
      currentState = actualState;

      if (!outcome.executed) {
        console.log(`[WhatIf] Step ${action.order} failed, stopping journey.`);
        break;
      }
    }

    console.log("[WhatIf] Summarizing journey...");
    const { outcome, summary } = await summarizeJourney(
      parsed.intent,
      parsed.userProfile,
      steps
    );

    return {
      url,
      question,
      intent: parsed.intent,
      userProfile: parsed.userProfile,
      steps,
      outcome,
      summary,
      truncated: parsed.truncated,
    };
  } finally {
    await browser.close();
  }
}