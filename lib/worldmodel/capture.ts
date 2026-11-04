import { Browser, Page } from "playwright-core";
import { PageState, InteractiveElement } from "./types";
import { gotoAllowed, launchGuardedChromium } from "../security/url-guard";
import { buildFindElementScript, EXTRACT_STATE_SCRIPT, MAX_TITLE, TAG_ELEMENTS_SCRIPT } from "./page-scripts";

const BROWSER_PATH =
  "C:/Users/user/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe";

// El navegador del análisis sale a la red solo por el proxy del validador
// de URLs (lib/security/url-guard.ts).
export async function launchBrowser(): Promise<Browser> {
  return await launchGuardedChromium(BROWSER_PATH);
}

async function tagInteractiveElements(page: Page): Promise<void> {
  await page.evaluate(TAG_ELEMENTS_SCRIPT);
}

export async function captureState(page: Page): Promise<PageState> {
  await tagInteractiveElements(page);

  const url = page.url();
  // Con tope: el título entra en los prompts (inyección y volumen, paso 7).
  const title = (await page.title()).replace(/\s+/g, " ").trim().slice(0, MAX_TITLE);

  const screenshotBuffer = await page.screenshot({
    fullPage: false,
    type: "jpeg",
    quality: 60,
  });
  const screenshot = `data:image/jpeg;base64,${screenshotBuffer.toString("base64")}`;

  const extracted = (await page.evaluate(EXTRACT_STATE_SCRIPT)) as {
    headings: string[];
    interactiveElements: InteractiveElement[];
  };

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
    const page = await browser.newPage();
    await gotoAllowed(page, url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(1200);
    const state = await captureState(page);
    return { browser, page, state };
  } catch (error) {
    // Si el sitio no carga, el navegador no se cerraba nunca: cada intento
    // fallido dejaba un Chromium abierto.
    await browser.close().catch(() => {});
    throw error;
  }
}

export interface ElementCandidate {
  selector: string;
  label: string;
  // Puntaje de emparejamiento, 0–1 (ver findElementMatch).
  score: number;
  // Longitud compartida entre la etiqueta y la buscada, 0–1.
  coverage: number;
}

// Los mejores candidatos para una etiqueta, uno por etiqueta distinta y
// de mayor a menor puntaje. Vacío si nada se parece.
export async function findElementCandidates(
  page: Page,
  targetLabel: string,
  targetType: InteractiveElement["type"]
): Promise<ElementCandidate[]> {
  await tagInteractiveElements(page);
  const found = (await page.evaluate(buildFindElementScript(targetLabel, targetType))) as
    | ElementCandidate[]
    | null;
  return (found ?? []).map((c) => ({ ...c, score: Math.max(0, Math.min(1, c.score / 1000)) }));
}

// Mejor candidato para una etiqueta, con su puntaje de emparejamiento
// normalizado a 0–1 (el script puntúa de 0 a 1000: 1 = etiqueta idéntica,
// 0.9 = igual salvo números, 0.7 = una empieza por la otra, 0.5 = la
// contiene, 0.4 = está contenida, 0.3 = parecido sin números).
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