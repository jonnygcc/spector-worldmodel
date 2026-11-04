import { Browser, Locator, Page } from "playwright-core";
import { captureState, findElementCandidates, findElementMatch, launchBrowser, ElementCandidate } from "./capture";
import {
  Goal,
  Persona,
  PersonaMode,
  Route,
  RouteOutcome,
  RouteStep,
  RouteStepResult,
  RouteComparison,
  StepCheck,
} from "./goal-types";
import { PageState } from "./types";
import { describePersonaForPrompt } from "./persona-resolver";
import { redreamFromState } from "./route-dreamer";
import { checkGoalEvidence, GoalSignals, NO_SIGNALS, pickBestRouteId } from "./goal-evidence";
import { sameSite, siteHost } from "./step-guard";
import { askGemini, cleanJsonResponse } from "../llm/gemini";
import { PROMPTS } from "../llm/prompts";
import { fill } from "../llm/prompt-data";
import { COMPARE_SCHEMA } from "../llm/schemas";
import { gotoAllowed } from "../security/url-guard";
import { mustPropagate } from "../llm/model-errors";
import {
  ACTION_TIMEOUT_MS,
  checkDeadline,
  evaluateWithTimeout,
  MAX_PAGE_TEXT,
  newSandboxedPage,
  withTimeout,
} from "../security/browser-sandbox";

const ROUTES_TO_VERIFY = 2;

// Minimum match score (0–1, see findElementMatch) to consider the next step's element present.
const MATCH_THRESHOLD = 0.5;
// Confidence = score × coverage. At 0.6, "Search" for "search button" starts the same (0.69) but
// covers half the label (0.32), so it isn't clicked.
const STRICT_THRESHOLD = 0.6;
// Another candidate with a different label within this margin of the best makes the step ambiguous.
const AMBIGUITY_MARGIN = 0.1;
// Re-plans per route; needing a third makes the route 'unreachable'.
const MAX_REDREAMS = 2;
// Cap on attempted steps per route, across all plans.
const MAX_ATTEMPTS = 12;

const needsElement = (step: RouteStep) => step.type === "click" || step.type === "type";

// The whole page: comparing only the first 3000 characters missed a cart drawer appended at the end
// of the body. Capped and timed so a huge or frozen page can't stall the analysis.
const pageText = async (page: Page): Promise<string> =>
  (await evaluateWithTimeout<string>(
    page,
    `document.body ? document.body.innerText.slice(0, ${MAX_PAGE_TEXT}) : ''`
  ).catch(() => "")) || "";

// ---- Step action ----
async function act(
  page: Page,
  step: RouteStep,
  element: Locator | null
): Promise<{ executed: boolean; stateChanged: boolean }> {
  const urlBefore = page.url();
  const bodyBefore = await pageText(page);

  try {
    if (step.type === "scroll") {
      await evaluateWithTimeout(page, "window.scrollBy(0, window.innerHeight)");
      await page.waitForTimeout(1000);
      return { executed: true, stateChanged: true };
    }
    if (step.type === "press") {
      await withTimeout(page.keyboard.press(step.value || "Enter"), ACTION_TIMEOUT_MS, "The key press timed out.");
      await page.waitForTimeout(2000);
    } else if (element) {
      await element.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
      if (step.type === "type") {
        await element.click({ timeout: 6000 }).catch(() => {});
        await element.fill(step.value || "", { timeout: 6000 });
        return { executed: true, stateChanged: true };
      }
      try {
        await element.click({ timeout: 6000 });
      } catch {
        // A popup or banner covers the element: a DOM click still fires its handlers.
        await withTimeout(
          element.evaluate((el) => (el as HTMLElement).click()),
          ACTION_TIMEOUT_MS,
          "The click timed out."
        );
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
    // no navigation
  }

  await page.waitForTimeout(1500);
  if (page.url() !== urlBefore) {
    await page.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => {});
    return { executed: true, stateChanged: true };
  }
  const bodyAfter = await pageText(page);
  return { executed: true, stateChanged: bodyBefore !== bodyAfter };
}

// ---- Expectation check, without the model ----
const normalize = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
const withoutHash = (u: string) => u.split("#")[0];
const occurrences = (text: string, needle: string) => (needle ? text.split(needle).length - 1 : 0);

async function checkExpectation(
  page: Page,
  step: RouteStep,
  urlBefore: string,
  textBefore: string,
  stateChanged: boolean,
  next: RouteStep | undefined
): Promise<{ check: StepCheck; checks: RouteStepResult["checks"] }> {
  const urlAfter = page.url();
  const text = normalize(await pageText(page));
  const before = normalize(textBefore);

  const urlChanged = withoutHash(urlAfter) !== withoutHash(urlBefore);
  const nav = step.navigationExpected ?? "unknown";
  const urlAsExpected = nav === "unknown" ? null : nav === "navigate" ? urlChanged : !urlChanged;
  const hint = step.expectedUrlHint ? step.expectedUrlHint.toLowerCase() : null;
  const urlHintMatched = hint ? urlAfter.toLowerCase().includes(hint) : null;

  const signals = step.expectedSignals ?? [];
  // A signal only counts if it's new or appears more often than before the action: "Cart" is always
  // in the header and proves nothing.
  const signalsFound = signals.filter(
    (sig) => occurrences(text, normalize(sig)) > occurrences(before, normalize(sig))
  );
  const signalsMissing = signals.filter((sig) => !signalsFound.includes(sig));

  let nextElementFound: boolean | null = null;
  if (next && needsElement(next)) {
    const match = await findElementMatch(page, next.targetElement, next.targetType);
    nextElementFound = !!match && match.score >= MATCH_THRESHOLD;
  }

  const checks = { urlChanged, urlAsExpected, urlHintMatched, signalsFound, signalsMissing, nextElementFound };

  // An action that changes nothing never meets the expectation.
  if (!stateChanged) return { check: "diverged", checks };

  // Each applicable check adds 0 to 1; signals count proportionally.
  const parts: number[] = [];
  if (urlAsExpected !== null) parts.push(urlAsExpected ? 1 : 0);
  if (urlHintMatched !== null) parts.push(urlHintMatched ? 1 : 0);
  if (signals.length > 0) parts.push(signalsFound.length / signals.length);
  if (nextElementFound !== null) parts.push(nextElementFound ? 1 : 0);
  if (parts.length === 0) return { check: "partial", checks };

  const ratio = parts.reduce((a, b) => a + b, 0) / parts.length;
  const check: StepCheck = ratio >= 0.75 ? "match" : ratio >= 0.34 ? "partial" : "diverged";
  return { check, checks };
}

// ---- Pre-check: can the candidate be clicked with confidence? ----
const confidence = (c: ElementCandidate) => Math.round(c.score * c.coverage * 100) / 100;

function preCheck(
  step: RouteStep,
  candidates: ElementCandidate[]
): { ok: true } | { ok: false; reason: string; rivals: { label: string; score: number }[] } {
  const [best, ...others] = candidates;
  if (!best) return { ok: false, reason: `Could not find "${step.targetElement}" on this page.`, rivals: [] };
  const top = confidence(best);
  if (top < STRICT_THRESHOLD) {
    return {
      ok: false,
      reason: `Closest element was "${best.label}" (confidence ${top}), below the ${STRICT_THRESHOLD} threshold.`,
      rivals: [],
    };
  }
  // An identical label isn't ambiguous: the others are something else.
  const rivals = top >= 1 ? [] : others.filter((c) => confidence(c) >= top - AMBIGUITY_MARGIN);
  if (rivals.length > 0) {
    return {
      ok: false,
      reason: `"${step.targetElement}" is ambiguous: "${best.label}" (${top}) and ${rivals
        .map((c) => `"${c.label}" (${confidence(c)})`)
        .join(", ")} score alike.`,
      rivals: rivals.map((c) => ({ label: c.label, score: confidence(c) })),
    };
  }
  return { ok: true };
}

// ---- Did the site stop the route? Login, payment or bot protection ----
async function detectBlock(page: Page, goal: Goal): Promise<string | null> {
  const goalText = `${goal.description} ${goal.successCriteria}`.toLowerCase();
  const found = (await evaluateWithTimeout(
    page,
    `(() => {
      const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
      const text = (document.title + ' ' + (document.body ? document.body.innerText.slice(0, 4000) : '')).toLowerCase();
      const password = Array.from(document.querySelectorAll('input[type="password"]')).some(visible);
      const card = Array.from(document.querySelectorAll('input')).some((el) => visible(el) && /cc-number|card ?number|cardnumber/i.test((el.getAttribute('autocomplete') || '') + ' ' + (el.getAttribute('name') || '') + ' ' + (el.getAttribute('placeholder') || '') + ' ' + (el.id || '')));
      return { text, password, card };
    })()`
  ).catch(() => null)) as { text: string; password: boolean; card: boolean } | null;
  if (!found) return null;

  // The text comes in the site's language: Google serves its /sorry/ page in Spanish here ("tráfico inusual").
  if (
    /\/sorry\/|captcha|cdn-cgi\/challenge/i.test(page.url()) ||
    /captcha|verify you are human|are you a robot|access denied|checking your browser|unusual traffic|press and hold|press & hold|tráfico inusual|no soy un robot|acceso denegado/.test(found.text)
  ) {
    return "The site showed a bot check or denied access.";
  }
  if (found.password && !/sign|log ?in|account|register|password/.test(goalText)) {
    return "The site asked the user to log in.";
  }
  if (found.card && !/pay|checkout|purchase|buy|order/.test(goalText)) {
    return "The site asked for payment details.";
  }
  return null;
}

// ---- Verify a route in the browser, re-planning when it diverges ----
async function verifyRoute(
  browser: Browser,
  url: string,
  route: Route,
  goal: Goal,
  persona: Persona,
  goalSignals: GoalSignals
): Promise<Route> {
  // A fresh context per route: no cookies or storage from the other route.
  const page = await newSandboxedPage(browser);
  const results: RouteStepResult[] = [];
  let plan = route.predictedSteps;
  let planNumber = 0;
  let i = 0;
  let outcome: RouteOutcome | null = null;
  let blockReason = "";
  // The route left the analyzed site: it ends there (step-guard.ts).
  let leftSite = "";

  let replansBeforeAction = 0;

  // The triggering step is an engine stumble and gets discarded, unless it changed the page and the re-plan
  // says the goal is met: that step is the one that arrived. Earlier good steps stay; the new plan starts there.
  const replan = async (trigger: "before-action" | "after-action", reason: string): Promise<boolean> => {
    const last = results[results.length - 1];
    last.redream = trigger;
    last.discarded = true;
    if (planNumber >= MAX_REDREAMS) {
      console.log(`  [${route.id}] would need re-dream #${planNumber + 1}: unreachable`);
      outcome = "unreachable";
      return false;
    }
    planNumber += 1;
    if (trigger === "before-action") replansBeforeAction += 1;
    console.log(`  [${route.id}] re-dream #${planNumber} (${trigger}): ${reason}`);
    const state = await captureState(page);
    const next = await redreamFromState(state, goal, persona, results, reason);
    if (next.goalAlreadyMet) {
      if (last.executed && last.stateChanged) last.discarded = false;
      outcome = "reached";
      return false;
    }
    if (next.steps.length === 0) {
      outcome = "unreachable";
      return false;
    }
    plan = next.steps;
    i = 0;
    return true;
  };

  try {
    await gotoAllowed(page, url, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    await page.keyboard.press("Escape").catch(() => {});
    // The site is where the URL landed (linear.app → www.linear.app); its text is the baseline for the
    // goal signals at the end.
    const siteUrl = page.url();
    const initialText = await pageText(page);

    while (outcome === null) {
      if (results.length >= MAX_ATTEMPTS) {
        outcome = "unreachable";
        break;
      }
      // Plan finished and the last step didn't diverge: goal met.
      if (i >= plan.length) {
        outcome = "reached";
        break;
      }

      const step = plan[i];
      console.log(`  [${route.id}] plan ${planNumber} step ${i + 1}: "${step.targetElement}"`);
      const urlBefore = page.url();

      // 1. Pre-check: the best candidate must clear the strict threshold with no close rivals; otherwise
      //    re-plan without clicking anything.
      let element: Locator | null = null;
      let found: RouteStepResult["found"] = null;
      if (needsElement(step)) {
        const candidates = await findElementCandidates(page, step.targetElement, step.targetType);
        const best = candidates[0];
        found = best ? { label: best.label, score: confidence(best) } : null;
        const pre = preCheck(step, candidates);
        if (!pre.ok) {
          const state = await captureState(page);
          results.push({
            step, plan: planNumber, found, rivals: pre.rivals, executed: false, stateChanged: false, check: "diverged",
            checks: { urlChanged: false, urlAsExpected: null, urlHintMatched: null, signalsFound: [], signalsMissing: step.expectedSignals ?? [], nextElementFound: null },
            actualUrl: state.url, actualTitle: state.title, screenshot: state.screenshot, realFriction: 1,
            whatHappened: `Did not act. ${pre.reason}`,
          });
          if (!(await replan("before-action", `Did not act. ${pre.reason}`))) break;
          continue;
        }
        element = page.locator(best.selector).first();
      }

      // 2. Action.
      const textBefore = await pageText(page);
      const done = await act(page, step, element);
      const state = await captureState(page);

      // 3. Left the analyzed site? A page link can't take the agent to another domain and still count as
      //    this site's flow.
      const offSite = sameSite(siteUrl, page.url())
        ? null
        : `Left the analyzed site for ${siteHost(page.url()) ?? "another page"}.`;

      // 4. Did the site stop it?
      const block = offSite ? null : await detectBlock(page, goal);

      // 5. Expectation.
      const { check, checks } = await checkExpectation(page, step, urlBefore, textBefore, done.stateChanged, plan[i + 1]);
      const whatHappened = offSite
        ? offSite
        : block
        ? block
        : !done.executed
          ? `Could not click "${found?.label ?? step.targetElement}".`
          : !done.stateChanged
            ? "The element was clicked but nothing on the page changed."
            : checks.urlChanged
              ? `Moved to "${state.title}".`
              : "The page changed without navigating.";
      results.push({
        step, plan: planNumber, found, executed: done.executed, stateChanged: done.stateChanged, check, checks,
        actualUrl: state.url, actualTitle: state.title, screenshot: state.screenshot,
        realFriction: offSite || !done.executed ? 1 : check === "diverged" ? 0.7 : check === "partial" ? 0.3 : 0,
        whatHappened,
      });

      if (offSite) {
        outcome = "unreachable";
        leftSite = offSite;
        break;
      }
      if (block) {
        outcome = "blocked";
        blockReason = block;
        break;
      }
      if (!done.executed || check === "diverged") {
        const reason = !done.executed
          ? `The click on "${found?.label ?? step.targetElement}" failed.`
          : `After "${step.description}", the page did not match the expectation (url ${checks.urlChanged ? "changed" : "unchanged"}, signals found: ${checks.signalsFound.join(", ") || "none"}).`;
        if (!(await replan("after-action", reason))) break;
        continue;
      }
      i += 1;
    }

    const finalState = await captureState(page);
    const finalOutcome: RouteOutcome = outcome ?? "unreachable";

    // Did it really arrive? A finished plan or the model saying the goal is met isn't enough: code looks
    // for the goal signals on the final page.
    const evidence =
      finalOutcome === "reached"
        ? checkGoalEvidence(goalSignals, initialText, await pageText(page), page.url())
        : null;
    await page.close();
    // Metrics only over the path: steps discarded on re-plan are engine stumbles, not the site's flow.
    const path = results.filter((r) => !r.discarded);
    const completed = path.filter((r) => r.executed && r.stateChanged).length;
    const partials = path.filter((r) => r.check === "partial").length;

    // Penalizes the ending, extra steps and partly met expectations. Re-plans don't add: they're the
    // engine's, not the site's.
    const endPenalty = finalOutcome === "reached" ? 0 : finalOutcome === "blocked" ? 0.6 : 1;
    const lengthPenalty = Math.max(0, (completed - 2) * 0.1);
    const realFriction = Math.min(1, endPenalty + lengthPenalty + partials * 0.05);

    return {
      ...route,
      verified: true,
      stepResults: results,
      realFriction,
      reachedGoal: finalOutcome === "reached",
      outcome: finalOutcome,
      replanned: planNumber > 0,
      replanCount: planNumber,
      replansBeforeAction,
      pathSteps: path.length,
      probabilityEstimated: planNumber > 0,
      goalVerified: evidence ? evidence.verified : undefined,
      goalSignalsFound: evidence ? evidence.found : undefined,
      verdict:
        finalOutcome === "reached"
          ? evidence?.verified
            ? `Reached the goal in ${completed} steps${planNumber > 0 ? ` after ${planNumber} re-plan${planNumber > 1 ? "s" : ""}` : ""}, ending on "${finalState.title}".`
            : `Reached the end of the route in ${completed} steps, ending on "${finalState.title}", but the goal could not be confirmed on that page.`
          : finalOutcome === "blocked"
            ? `Blocked after ${completed} steps: ${blockReason}`
            : leftSite
              ? `Stopped after ${completed} steps: ${leftSite}`
              : `No path to the goal after ${planNumber} re-plan${planNumber === 1 ? "" : "s"} (${completed} steps completed).`,
    };
  } catch (error) {
    await page.close().catch(() => {});
    // Quota, deadline or disconnect aren't this route's failure: they propagate. If the browser closed
    // because the analysis ended, checkDeadline throws the real reason.
    if (mustPropagate(error)) throw error;
    checkDeadline();
    return {
      ...route,
      // Failed before the first step (the page didn't load): it never ran.
      verified: results.length > 0,
      stepResults: results,
      realFriction: 1,
      reachedGoal: false,
      outcome: "unreachable",
      replanned: planNumber > 0,
      replanCount: planNumber,
      replansBeforeAction,
      pathSteps: results.filter((r) => !r.discarded).length,
      probabilityEstimated: planNumber > 0,
      verdict: `Verification failed: ${(error as Error).message.split("\n")[0]}`,
    };
  }
}

// ---- Compare all routes and produce the verdict ----
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
    stepCount: r.verified ? r.pathSteps : r.predictedSteps.length,
    predictedFriction: r.predictedFriction,
    verified: r.verified,
    outcome: r.outcome,
    replanCount: r.replanCount,
    realFriction: r.realFriction,
    reachedGoal: r.reachedGoal,
    goalVerified: r.goalVerified === true,
    verdict: r.verdict,
  }));

  // Routes carry site text (labels, titles in the verdict), so they go as page_data.
  const response = await askGemini({
    system: fill(PROMPTS.compareRoutes, {
      GOAL_DESCRIPTION: goal.description,
      PERSONA_DESCRIPTION: describePersonaForPrompt(persona),
    }),
    pageData: { routes: compact },
    schema: COMPARE_SCHEMA,
  });
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

// ---- Orchestrator: verify the top routes and compare ----
export async function verifyAndCompare(
  url: string,
  goal: Goal,
  persona: Persona,
  personaMode: PersonaMode,
  initialState: PageState,
  routes: Route[],
  goalSignals: GoalSignals = NO_SIGNALS,
  // Called after verification and before comparing, so listeners can tell the two stages apart.
  onCompare?: () => void
): Promise<RouteComparison> {
  const browser = await launchBrowser();

  try {
    const sorted = [...routes].sort((a, b) => b.probability - a.probability);
    const toVerify = sorted.slice(0, ROUTES_TO_VERIFY);
    const rest = sorted.slice(ROUTES_TO_VERIFY);

    const verified: Route[] = [];

    for (const route of toVerify) {
      console.log(`[Routes] Verifying ${route.id} via "${route.entryPoint}"...`);
      const result = await verifyRoute(browser, url, route, goal, persona, goalSignals);
      verified.push(result);
    }

    const allRoutes = [...verified, ...rest];

    onCompare?.();
    console.log("[Routes] Comparing routes...");
    const comparison = await compareRoutes(goal, persona, allRoutes);

    // The best route must have run, arrived and been verified (goal-evidence.ts). The most likely one must
    // exist; if the model returns another id, the highest probability wins.
    const bestRouteId = pickBestRouteId(allRoutes, comparison.bestRouteId);
    const mostLikelyRouteId = allRoutes.some((r) => r.id === comparison.mostLikelyRouteId)
      ? comparison.mostLikelyRouteId
      : (sorted[0]?.id ?? null);

    return {
      url,
      goal,
      persona,
      personaMode,
      initialState,
      routes: allRoutes,
      routesFound: routes.length,
      goalSignals,
      bestRouteId,
      mostLikelyRouteId,
      verdict: comparison.verdict,
      recommendation: comparison.recommendation,
    };
  } finally {
    await browser.close();
  }
}