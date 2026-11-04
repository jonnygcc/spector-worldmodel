import { Browser, Page } from "playwright-core";
import { PageState, InteractiveElement } from "./types";
import { gotoAllowed, launchGuardedChromium } from "../security/url-guard";
import {
  evaluateWithTimeout,
  newSandboxedPage,
  resolveChromiumPath,
  SANDBOX_ARGS,
  trackBrowser,
} from "../security/browser-sandbox";
import { buildFindElementScript, EXTRACT_STATE_SCRIPT, MAX_TITLE, TAG_ELEMENTS_SCRIPT } from "./page-scripts";

// Egress only through the URL guard's proxy, no permission prompts, and registered in the analysis
// session so it always gets closed.
export async function launchBrowser(): Promise<Browser> {
  return await trackBrowser(await launchGuardedChromium(resolveChromiumPath(), undefined, SANDBOX_ARGS));
}

async function tagInteractiveElements(page: Page): Promise<void> {
  await evaluateWithTimeout(page, TAG_ELEMENTS_SCRIPT);
}

export async function captureState(page: Page): Promise<PageState> {
  await tagInteractiveElements(page);

  const url = page.url();
  // Capped: the title ends up in prompts (injection and volume).
  const title = ((await evaluateWithTimeout<string>(page, "document.title")) || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TITLE);

  const screenshotBuffer = await page.screenshot({
    fullPage: false,
    type: "jpeg",
    quality: 60,
  });
  const screenshot = `data:image/jpeg;base64,${screenshotBuffer.toString("base64")}`;

  const extracted = await evaluateWithTimeout<{
    headings: string[];
    interactiveElements: InteractiveElement[];
  }>(page, EXTRACT_STATE_SCRIPT);

  return {
    url,
    title,
    headings: extracted.headings,
    interactiveElements: extracted.interactiveElements,
    screenshot,
  };
}

export async function visitAndCapture(url: string): Promise<{
  browser: Browser;
  page: Page;
  state: PageState;
}> {
  const browser = await launchBrowser();
  try {
    const page = await newSandboxedPage(browser);
    await gotoAllowed(page, url, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    const state = await captureState(page);
    return { browser, page, state };
  } catch (error) {
    // Without this, every failed load left a Chromium open.
    await browser.close().catch(() => {});
    throw error;
  }
}

export interface ElementCandidate {
  selector: string;
  label: string;
  // Match score, 0–1 (see findElementMatch).
  score: number;
  // Share of the label in common with the target, 0–1.
  coverage: number;
}

// One per distinct label, best first; empty if nothing is close.
export async function findElementCandidates(
  page: Page,
  targetLabel: string,
  targetType: InteractiveElement["type"]
): Promise<ElementCandidate[]> {
  await tagInteractiveElements(page);
  const found = await evaluateWithTimeout<ElementCandidate[] | null>(
    page,
    buildFindElementScript(targetLabel, targetType)
  );
  return (found ?? []).map((c) => ({ ...c, score: Math.max(0, Math.min(1, c.score / 1000)) }));
}

// Score normalized from the script's 0–1000: 1 identical, 0.9 same but numbers, 0.7 prefix,
// 0.5 contains, 0.4 contained, 0.3 similar without numbers.
export async function findElementMatch(
  page: Page,
  targetLabel: string,
  targetType: InteractiveElement["type"]
): Promise<{ selector: string; label: string; score: number } | null> {
  const [best] = await findElementCandidates(page, targetLabel, targetType);
  return best ? { selector: best.selector, label: best.label, score: best.score } : null;
}

export async function retagAndFindElement(
  page: Page,
  targetLabel: string,
  targetType: InteractiveElement["type"]
): Promise<string | null> {
  const match = await findElementMatch(page, targetLabel, targetType);
  return match ? match.selector : null;
}