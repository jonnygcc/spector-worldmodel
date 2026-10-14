import { Browser, Page } from "playwright-core";
import { captureState, retagAndFindElement, launchBrowser } from "./capture";
import {
  Goal,
  Persona,
  PersonaMode,
  Route,
  RouteStep,
  RouteStepResult,
  RouteComparison,
} from "./goal-types";
import { PageState } from "./types";
import { describePersonaForPrompt } from "./persona-resolver";
import { askGemini, cleanJsonResponse } from "../llm/gemini";
import { PROMPTS } from "../llm/prompts";

const ROUTES_TO_VERIFY = 2;

// ============================================================
// Ejecuta un paso individual dentro de una ruta
// ============================================================
async function runStep(page: Page, step: RouteStep): Promise<{
  executed: boolean;
  stateChanged: boolean;
}> {
  const urlBefore = page.url();
  const bodyBefore = (await page
    .evaluate("document.body.innerText.substring(0, 3000)")
    .catch(() => "")) as string;

  try {
    if (step.type === "scroll") {
      await page.evaluate("window.scrollBy(0, window.innerHeight)");
      await page.waitForTimeout(1000);
      return { executed: true, stateChanged: true };
    }

    if (step.type === "press") {
      await page.keyboard.press(step.value || "Enter");
      await page.waitForTimeout(2000);
    } else {
      const selector = await retagAndFindElement(page, step.targetElement, step.targetType);
      if (!selector) return { executed: false, stateChanged: false };

      const element = page.locator(selector).first();
      await element.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});

      if (step.type === "click") {
        await element.click({ timeout: 6000 });
      } else if (step.type === "type") {
        await element.click({ timeout: 6000 }).catch(() => {});
        await element.fill(step.value || "", { timeout: 6000 });
        return { executed: true, stateChanged: true };
      }
    }
  } catch {
    return { executed: false, stateChanged: false };
  }

  try {
    await page.waitForURL((u) => u.toString() !== urlBefore, { timeout: 5000 });
    await page.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(1200);
    return { executed: true, stateChanged: true };
  } catch {
    // sin navegacion
  }

  await page.waitForTimeout(1500);

  if (page.url() !== urlBefore) {
    await page.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => {});
    return { executed: true, stateChanged: true };
  }

  const bodyAfter = (await page
    .evaluate("document.body.innerText.substring(0, 3000)")
    .catch(() => "")) as string;

  return { executed: true, stateChanged: bodyBefore !== bodyAfter };
}

// ============================================================
// Verifica una ruta completa en el navegador
// ============================================================
async function verifyRoute(
  browser: Browser,
  url: string,
  route: Route,
  goal: Goal
): Promise<Route> {
  const page = await browser.newPage();
  const stepResults: RouteStepResult[] = [];

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(1200);

    let blocked = false;

    for (const step of route.predictedSteps) {
      if (blocked) break;

      console.log(`  [${route.id}] step ${step.order}: "${step.targetElement}"`);
      const outcome = await runStep(page, step);
      const state = await captureState(page);

      let friction = 0;
      let whatHappened = "";

      if (!outcome.executed) {
        friction = 1;
        whatHappened = `Could not find or click "${step.targetElement}" on this page.`;
        blocked = true;
      } else if (!outcome.stateChanged) {
        friction = 0.7;
        whatHappened = "The element was clicked but nothing on the page changed.";
        blocked = true;
      } else {
        friction = 0;
        whatHappened = `Moved to "${state.title}".`;
      }

      stepResults.push({
        executed: outcome.executed,
        stateChanged: outcome.stateChanged,
        actualUrl: state.url,
        actualTitle: state.title,
        screenshot: state.screenshot,
        realFriction: friction,
        whatHappened,
      });
    }

    const finalState = await captureState(page);
    await page.close();

    const completedSteps = stepResults.filter((s) => s.executed && s.stateChanged).length;
    const totalSteps = route.predictedSteps.length;

    // Friccion real: penaliza pasos bloqueados y pasos extra
    const blockedPenalty = stepResults.some((s) => s.realFriction >= 0.7) ? 0.6 : 0;
    const incompletePenalty = completedSteps < totalSteps ? 0.3 : 0;
    const lengthPenalty = Math.max(0, (totalSteps - 2) * 0.1);
    const realFriction = Math.min(1, blockedPenalty + incompletePenalty + lengthPenalty);

    const reachedGoal = completedSteps === totalSteps && blockedPenalty === 0;

    return {
      ...route,
      verified: true,
      stepResults,
      realFriction,
      reachedGoal,
      verdict: reachedGoal
        ? `Completed all ${totalSteps} steps and ended on "${finalState.title}".`
        : `Stopped after ${completedSteps} of ${totalSteps} steps.`,
    };
  } catch (error) {
    await page.close().catch(() => {});
    return {
      ...route,
      verified: false,
      stepResults,
      realFriction: 1,
      reachedGoal: false,
      verdict: `Verification failed: ${(error as Error).message.split("\n")[0]}`,
    };
  }
}

// ============================================================
// Compara todas las rutas y genera el veredicto
// ============================================================
async function compareRoutes(
  goal: Goal,
  persona: Persona,
  routes: Route[]
): Promise<{
  bestRouteId: string | null;
  mostLikelyRouteId: string | null;
  verdict: string;
  recommendation: string;
}> {
  const compact = routes.map((r) => ({
    id: r.id,
    entryPoint: r.entryPoint,
    probability: r.probability,
    stepCount: r.predictedSteps.length,
    predictedFriction: r.predictedFriction,
    verified: r.verified,
    realFriction: r.realFriction,
    reachedGoal: r.reachedGoal,
    verdict: r.verdict,
  }));

  const prompt = PROMPTS.compareRoutes
    .replace("{GOAL_DESCRIPTION}", goal.description)
    .replace("{PERSONA_DESCRIPTION}", describePersonaForPrompt(persona))
    .replace("{ROUTES_JSON}", JSON.stringify(compact, null, 2));

  const response = await askGemini(prompt);
  const cleaned = cleanJsonResponse(response);

  try {
    return JSON.parse(cleaned) as {
      bestRouteId: string | null;
      mostLikelyRouteId: string | null;
      verdict: string;
      recommendation: string;
    };
  } catch {
    const mostLikely = routes.length > 0 ? routes[0].id : null;
    return {
      bestRouteId: mostLikely,
      mostLikelyRouteId: mostLikely,
      verdict: "Routes were simulated but the comparison could not be generated.",
      recommendation: "Review the individual routes below.",
    };
  }
}

// ============================================================
// ORCHESTRATOR: verifica las rutas top y compara
// ============================================================
export async function verifyAndCompare(
  url: string,
  goal: Goal,
  persona: Persona,
  personaMode: PersonaMode,
  initialState: PageState,
  routes: Route[]
): Promise<RouteComparison> {
  const browser = await launchBrowser();

  try {
    const sorted = [...routes].sort((a, b) => b.probability - a.probability);
    const toVerify = sorted.slice(0, ROUTES_TO_VERIFY);
    const rest = sorted.slice(ROUTES_TO_VERIFY);

    const verified: Route[] = [];

    for (const route of toVerify) {
      console.log(`[Routes] Verifying ${route.id} via "${route.entryPoint}"...`);
      const result = await verifyRoute(browser, url, route, goal);
      verified.push(result);
    }

    const allRoutes = [...verified, ...rest];

    console.log("[Routes] Comparing routes...");
    const comparison = await compareRoutes(goal, persona, allRoutes);

    return {
      url,
      goal,
      persona,
      personaMode,
      initialState,
      routes: allRoutes,
      bestRouteId: comparison.bestRouteId,
      mostLikelyRouteId: comparison.mostLikelyRouteId,
      verdict: comparison.verdict,
      recommendation: comparison.recommendation,
    };
  } finally {
    await browser.close();
  }
}