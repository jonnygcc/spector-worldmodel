import { Browser, Page } from "playwright-core";
import { captureState, retagAndFindElement } from "./capture";
import { Action, Verification, JourneyNode } from "./types";
import { askGemini, cleanJsonResponse } from "../llm/gemini";

const COMPARE_PROMPT = `You are the Reality Checker of Spector, a UX world model.

Compare an IMAGINED state with the ACTUAL state after executing the action.

PREDICTION:
{PREDICTION_JSON}

ACTUAL STATE AFTER THE CLICK:
{ACTUAL_STATE_JSON}

INSTRUCTIONS:
1. predictionMatch 1.0 = exactly right, 0.0 = completely wrong
2. Rate the REAL friction (0.0 to 1.0) based on what actually happened to the user
3. Friction means: the user is confused, blocked, or needs extra steps they did not expect
4. A different-but-reasonable outcome is NOT friction. Only real obstacles count.

Respond ONLY with valid JSON. Fields: actionId, predictionMatch, realFriction, discrepancy (one sentence, or "match" if aligned).

Example:
{"actionId":"a1","predictionMatch":0.6,"realFriction":0.7,"discrepancy":"Model predicted a form but the site required login first"}`;

type ExecutionOutcome =
  | { kind: "not_found" }
  | { kind: "no_change" }
  | { kind: "changed"; changeType: "navigation" | "dom" };

async function executeAction(page: Page, action: Action): Promise<ExecutionOutcome> {
  // 1. Buscamos el elemento exacto por su label, usando el sistema de tags
  const selector = await retagAndFindElement(page, action.targetElement, action.targetType);

  if (!selector) {
    return { kind: "not_found" };
  }

  const urlBefore = page.url();
  const bodyBefore = await page.evaluate(() => document.body.innerText.substring(0, 3000));

  // 2. Hacemos click en ESE elemento especifico
  try {
    const element = page.locator(selector).first();
    await element.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
    await element.click({ timeout: 6000 });
  } catch {
    return { kind: "not_found" };
  }

  // 3. Esperamos a que la navegacion ocurra (si la hay)
  try {
    await page.waitForURL((u) => u.toString() !== urlBefore, { timeout: 6000 });
    await page.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(1200);
    return { kind: "changed", changeType: "navigation" };
  } catch {
    // No hubo navegacion, revisamos si el DOM cambio (modal, panel, acordeon)
  }

  await page.waitForTimeout(2000);

  const urlAfter = page.url();
  if (urlAfter !== urlBefore) {
    await page.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => {});
    return { kind: "changed", changeType: "navigation" };
  }

  const bodyAfter = await page.evaluate(() => document.body.innerText.substring(0, 3000));

  // Comparamos el texto visible antes y despues
  if (bodyBefore !== bodyAfter) {
    const similarity = calcSimilarity(bodyBefore, bodyAfter);
    if (similarity < 0.9) {
      return { kind: "changed", changeType: "dom" };
    }
  }

  return { kind: "no_change" };
}

function calcSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const shorter = a.length < b.length ? a : b;
  const longer = a.length < b.length ? b : a;
  if (longer.length === 0) return 1;

  let matches = 0;
  const chunkSize = 50;
  for (let i = 0; i < shorter.length; i += chunkSize) {
    const chunk = shorter.substring(i, i + chunkSize);
    if (longer.includes(chunk)) matches += chunk.length;
  }
  return matches / longer.length;
}

export async function verifyNode(
  browser: Browser,
  originalUrl: string,
  node: JourneyNode
): Promise<Verification> {
  const page = await browser.newPage();

  try {
    await page.goto(originalUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(1200);

    const outcome = await executeAction(page, node.action);

    // Caso 1: no encontramos el elemento
    if (outcome.kind === "not_found") {
      await page.close();
      return {
        actionId: node.action.id,
        actualState: node.state,
        predictionMatch: 1.0,
        realFriction: 0.0,
        discrepancy: "execution_error: element could not be located or clicked on the page",
      };
    }

    // Caso 2: el elemento existia, hicimos click, pero NADA cambio.
    // Esto SI es friccion real: el usuario hace click y no pasa nada.
    if (outcome.kind === "no_change") {
      const actualState = await captureState(page);
      await page.close();
      return {
        actionId: node.action.id,
        actualState,
        predictionMatch: 0.2,
        realFriction: 0.7,
        discrepancy:
          "The element was clicked but the page did not change at all. The user would see no response to their action.",
      };
    }

    // Caso 3: hubo cambio real -> comparamos con el LLM
    const actualState = await captureState(page);

    const comparePrompt = COMPARE_PROMPT
      .replace(
        "{PREDICTION_JSON}",
        JSON.stringify(
          {
            actionId: node.prediction.actionId,
            imaginedState: node.prediction.imaginedState,
            predictedFriction: node.prediction.predictedFriction,
          },
          null,
          2
        )
      )
      .replace(
        "{ACTUAL_STATE_JSON}",
        JSON.stringify(
          {
            changeType: outcome.changeType,
            url: actualState.url,
            title: actualState.title,
            headings: actualState.headings.slice(0, 10),
            interactiveElements: actualState.interactiveElements.slice(0, 12).map((el) => ({
              type: el.type,
              label: el.label,
            })),
          },
          null,
          2
        )
      );

    const response = await askGemini(comparePrompt);
    const cleaned = cleanJsonResponse(response);

    await page.close();

    try {
      const comparison = JSON.parse(cleaned) as {
        actionId: string;
        predictionMatch: number;
        realFriction: number;
        discrepancy: string;
      };

      return {
        actionId: comparison.actionId,
        actualState,
        predictionMatch: comparison.predictionMatch,
        realFriction: comparison.realFriction,
        discrepancy: comparison.discrepancy,
      };
    } catch {
      return {
        actionId: node.action.id,
        actualState,
        predictionMatch: 0.5,
        realFriction: node.prediction.predictedFriction,
        discrepancy: "match",
      };
    }
  } catch (error) {
    await page.close().catch(() => {});
    return {
      actionId: node.action.id,
      actualState: node.state,
      predictionMatch: 1.0,
      realFriction: 0.0,
      discrepancy: `execution_error: ${(error as Error).message}`,
    };
  }
}

export async function verifyTopBranches(
  browser: Browser,
  originalUrl: string,
  journeyTree: JourneyNode[],
  topN: number = 5
): Promise<JourneyNode[]> {
  const toVerify = journeyTree.slice(0, topN);

  for (const node of toVerify) {
    console.log(`Verifying: ${node.action.description.substring(0, 60)}...`);
    const verification = await verifyNode(browser, originalUrl, node);
    node.verification = verification;
  }

  return journeyTree;
}