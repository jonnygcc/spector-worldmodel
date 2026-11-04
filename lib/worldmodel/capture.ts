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

// El navegador del análisis sale a la red solo por el proxy del validador
// de URLs (lib/security/url-guard.ts), sin prompts de permisos, y queda
// registrado en la sesión del análisis para cerrarse siempre
// (lib/security/browser-sandbox.ts).
export async function launchBrowser(): Promise<Browser> {
  return await trackBrowser(await launchGuardedChromium(resolveChromiumPath(), undefined, SANDBOX_ARGS));
}

async function tagInteractiveElements(page: Page): Promise<void> {
  await evaluateWithTimeout(page, TAG_ELEMENTS_SCRIPT);
}

export async function captureState(page: Page): Promise<PageState> {
  await tagInteractiveElements(page);

  const url = page.url();
  // Con tope: el título entra en los prompts (inyección y volumen, paso 7).
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
  const found = await evaluateWithTimeout<ElementCandidate[] | null>(
    page,
    buildFindElementScript(targetLabel, targetType)
  );
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