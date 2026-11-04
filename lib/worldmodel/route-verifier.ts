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
import { askGemini, cleanJsonResponse } from "../llm/gemini";
import { PROMPTS } from "../llm/prompts";
import { gotoAllowed } from "../security/url-guard";

const ROUTES_TO_VERIFY = 2;

// Puntaje mínimo de emparejamiento (0–1, ver findElementMatch) para dar
// por presente el elemento del paso siguiente al comprobar la expectativa.
const MATCH_THRESHOLD = 0.5;
// Verificación previa, antes de pulsar nada. Confianza = puntaje × cobertura
// (la parte de la etiqueta que comparten). Umbral estricto 0.6: pasan la
// etiqueta idéntica (1), la idéntica salvo números (0.9) y las que empiezan
// igual y casi miden lo mismo. "Search" para "search button" empieza igual
// (0.69) pero cubre la mitad: 0.32, no se pulsa.
const STRICT_THRESHOLD = 0.6;
// Si otro candidato con etiqueta distinta queda a menos de esto del mejor,
// el paso es ambiguo y tampoco se pulsa.
const AMBIGUITY_MARGIN = 0.1;
// Re-sueños por ruta. Si hace falta un tercero, la ruta es 'unreachable'.
const MAX_REDREAMS = 2;
// Tope de pasos intentados por ruta, sumando todos los planes.
const MAX_ATTEMPTS = 12;

const needsElement = (step: RouteStep) => step.type === "click" || step.type === "type";

// Texto visible de toda la página. Antes se comparaban solo los primeros
// 3000 caracteres, y un cajón de carrito, que se añade al final del body,
// no contaba como cambio.
const pageText = async (page: Page): Promise<string> =>
  ((await page.evaluate("document.body ? document.body.innerText : ''").catch(() => "")) as string) || "";

// ============================================================
// Acción de un paso
// ============================================================
async function act(
  page: Page,
  step: RouteStep,
  element: Locator | null
): Promise<{ executed: boolean; stateChanged: boolean }> {
  const urlBefore = page.url();
  const bodyBefore = await pageText(page);

  try {
    if (step.type === "scroll") {
      await page.evaluate("window.scrollBy(0, window.innerHeight)");
      await page.waitForTimeout(1000);
      return { executed: true, stateChanged: true };
    }
    if (step.type === "press") {
      await page.keyboard.press(step.value || "Enter");
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
        // Un popup o un banner tapa el elemento: click directo en el DOM,
        // que dispara sus handlers aunque haya algo encima.
        await element.evaluate((el) => (el as HTMLElement).click());
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
    // sin navegación
  }

  await page.waitForTimeout(1500);
  if (page.url() !== urlBefore) {
    await page.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => {});
    return { executed: true, stateChanged: true };
  }
  const bodyAfter = await pageText(page);
  return { executed: true, stateChanged: bodyBefore !== bodyAfter };
}

// ============================================================
// Comprobación de la expectativa, sin el modelo
// ============================================================
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
  // Una señal solo cuenta si es nueva o aparece más veces que antes de la
  // acción: "Cart" está siempre en la cabecera y no prueba nada.
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

  // Una acción que no cambia nada nunca cumple la expectativa.
  if (!stateChanged) return { check: "diverged", checks };

  // Cada comprobación aplicable suma de 0 a 1; las señales, en proporción.
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

// ============================================================
// Verificación previa: ¿se puede pulsar el candidato con confianza?
// ============================================================
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
  // Una etiqueta idéntica no es ambigua: las demás son otra cosa.
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

// ============================================================
// ¿El sitio detuvo la ruta? Login, pago o protección anti-bots
// ============================================================
async function detectBlock(page: Page, goal: Goal): Promise<string | null> {
  const goalText = `${goal.description} ${goal.successCriteria}`.toLowerCase();
  const found = (await page
    .evaluate(`(() => {
      const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
      const text = (document.title + ' ' + (document.body ? document.body.innerText.slice(0, 4000) : '')).toLowerCase();
      const password = Array.from(document.querySelectorAll('input[type="password"]')).some(visible);
      const card = Array.from(document.querySelectorAll('input')).some((el) => visible(el) && /cc-number|card ?number|cardnumber/i.test((el.getAttribute('autocomplete') || '') + ' ' + (el.getAttribute('name') || '') + ' ' + (el.getAttribute('placeholder') || '') + ' ' + (el.id || '')));
      return { text, password, card };
    })()`)
    .catch(() => null)) as { text: string; password: boolean; card: boolean } | null;
  if (!found) return null;

  // El texto sale en el idioma del sitio: Google le sirve a este equipo su
  // página /sorry/ en español ("tráfico inusual").
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

// ============================================================
// Verifica una ruta en el navegador, re-soñando si diverge
// ============================================================
async function verifyRoute(
  browser: Browser,
  url: string,
  route: Route,
  goal: Goal,
  persona: Persona
): Promise<Route> {
  const page = await browser.newPage();
  const results: RouteStepResult[] = [];
  let plan = route.predictedSteps;
  let planNumber = 0;
  let i = 0;
  let outcome: RouteOutcome | null = null;
  let blockReason = "";

  let replansBeforeAction = 0;

  // Re-sueño desde la página real, disparado por el último resultado.
  // Devuelve false si la ruta termina.
  //
  // El paso que lo disparó es un tropiezo del motor: queda descartado (se
  // guarda, no cuenta). La excepción: un paso que sí cambió la página y
  // tras el que el re-sueño dice que el objetivo ya está cumplido; ese
  // paso fue el que llegó. Los pasos anteriores del plan abandonado que
  // salieron bien se quedan: el navegador está donde ellos lo dejaron y
  // el nuevo plan sigue desde ahí.
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
    await gotoAllowed(page, url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(1200);
    await page.keyboard.press("Escape").catch(() => {});

    while (outcome === null) {
      if (results.length >= MAX_ATTEMPTS) {
        outcome = "unreachable";
        break;
      }
      // Plan terminado y el último paso no divergió: objetivo cumplido.
      if (i >= plan.length) {
        outcome = "reached";
        break;
      }

      const step = plan[i];
      console.log(`  [${route.id}] plan ${planNumber} step ${i + 1}: "${step.targetElement}"`);
      const urlBefore = page.url();

      // 1. Verificación previa: el mejor candidato debe superar el umbral
      //    estricto y no tener rivales parecidos. Si no, re-sueño sin
      //    pulsar nada.
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

      // 2. Acción.
      const textBefore = await pageText(page);
      const done = await act(page, step, element);
      const state = await captureState(page);

      // 3. ¿El sitio la detuvo?
      const block = await detectBlock(page, goal);

      // 4. Expectativa.
      const { check, checks } = await checkExpectation(page, step, urlBefore, textBefore, done.stateChanged, plan[i + 1]);
      const whatHappened = block
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
        realFriction: !done.executed ? 1 : check === "diverged" ? 0.7 : check === "partial" ? 0.3 : 0,
        whatHappened,
      });

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
    await page.close();

    const finalOutcome: RouteOutcome = outcome ?? "unreachable";
    // Métricas solo sobre el camino: los pasos descartados al replanificar
    // describen los tropiezos del motor, no el flujo del sitio.
    const path = results.filter((r) => !r.discarded);
    const completed = path.filter((r) => r.executed && r.stateChanged).length;
    const partials = path.filter((r) => r.check === "partial").length;

    // Fricción real: penaliza el final, los pasos de más y los que solo
    // cumplieron en parte la expectativa. Los re-sueños no suman: son del
    // motor, no del sitio.
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
      verdict:
        finalOutcome === "reached"
          ? `Reached the goal in ${completed} steps${planNumber > 0 ? ` after ${planNumber} re-plan${planNumber > 1 ? "s" : ""}` : ""}, ending on "${finalState.title}".`
          : finalOutcome === "blocked"
            ? `Blocked after ${completed} steps: ${blockReason}`
            : `No path to the goal after ${planNumber} re-plan${planNumber === 1 ? "" : "s"} (${completed} steps completed).`,
    };
  } catch (error) {
    await page.close().catch(() => {});
    return {
      ...route,
      // Si falló antes del primer paso (la página no cargó), no se ejecutó.
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
    stepCount: r.verified ? r.pathSteps : r.predictedSteps.length,
    predictedFriction: r.predictedFriction,
    verified: r.verified,
    outcome: r.outcome,
    replanCount: r.replanCount,
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
  routes: Route[],
  // Se llama al terminar la verificación y antes de comparar, para que
  // quien escuche pueda distinguir las dos etapas.
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
      const result = await verifyRoute(browser, url, route, goal, persona);
      verified.push(result);
    }

    const allRoutes = [...verified, ...rest];

    onCompare?.();
    console.log("[Routes] Comparing routes...");
    const comparison = await compareRoutes(goal, persona, allRoutes);

    // El mejor solo puede ser una ruta ejecutada que llegó al objetivo.
    const best = allRoutes.find((r) => r.id === comparison.bestRouteId);
    const bestRouteId = best && best.verified && best.outcome === "reached" ? best.id : null;

    return {
      url,
      goal,
      persona,
      personaMode,
      initialState,
      routes: allRoutes,
      routesFound: routes.length,
      bestRouteId,
      mostLikelyRouteId: comparison.mostLikelyRouteId,
      verdict: comparison.verdict,
      recommendation: comparison.recommendation,
    };
  } finally {
    await browser.close();
  }
}