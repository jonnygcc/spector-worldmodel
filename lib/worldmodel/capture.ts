import { chromium, Browser, Page } from "playwright-core";
import { PageState, InteractiveElement } from "./types";

const BROWSER_PATH =
  "C:/Users/user/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe";

export async function launchBrowser(): Promise<Browser> {
  return await chromium.launch({
    executablePath: BROWSER_PATH,
    headless: true,
  });
}

/**
 * Inyecta un atributo data-spector-id unico a cada elemento interactivo visible.
 * El codigo se pasa como string para evitar que el compilador inyecte helpers
 * que no existen dentro del navegador.
 */
const TAG_ELEMENTS_SCRIPT = `
(() => {
  // El contador vive en la página: si empezara en 0 en cada llamada, los
  // elementos que aparecen después (un desplegable) repetirían ids ya
  // usados, y el selector resolvería al primero del DOM. En Google, el
  // "Buscar con Google" del desplegable salía como sp-0, igual que el
  // botón de Aplicaciones, y se pulsaba ese.
  let counter = window.__spectorCounter || 0;

  const isVisible = (el) => {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }
    return true;
  };

  const selectors = [
    'button',
    "[role='button']",
    "input[type='submit']",
    'a[href]',
    "input[type='text']",
    "input[type='search']",
    "input[type='email']",
    'textarea'
  ];

  selectors.forEach((sel) => {
    document.querySelectorAll(sel).forEach((el) => {
      if (el.hasAttribute('data-spector-id')) return;
      if (!isVisible(el)) return;
      el.setAttribute('data-spector-id', 'sp-' + (counter++));
    });
  });
  window.__spectorCounter = counter;
})()
`;

const EXTRACT_STATE_SCRIPT = `
(() => {
  const metaEl = document.querySelector('meta[name="description"]');
  const metaDescription = metaEl ? (metaEl.getAttribute('content') || '') : '';

  const headings = Array.prototype.slice
    .call(document.querySelectorAll('h1, h2, h3'), 0, 15)
    .map((el) => el.tagName + ': ' + (el.textContent || '').trim());

  const interactiveElements = [];

  document.querySelectorAll('[data-spector-id]').forEach((el) => {
    const id = el.getAttribute('data-spector-id');
    const rect = el.getBoundingClientRect();
    const tag = el.tagName.toLowerCase();

    let type;
    if (tag === 'a') type = 'link';
    else if (tag === 'input' && el.type === 'submit') type = 'button';
    else if (tag === 'input' || tag === 'textarea') type = 'input';
    else type = 'button';

    let label = '';
    if (type === 'input') {
      label = el.getAttribute('placeholder') || el.getAttribute('aria-label') || el.getAttribute('name') || 'unnamed input';
    } else {
      label = (el.textContent || '').trim() || el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('value') || 'unnamed';
    }

    label = label.replace(/\\s+/g, ' ').trim();
    if (label.length > 70) label = label.substring(0, 70);
    if (label.length < 1) return;

    interactiveElements.push({
      type: type,
      label: label,
      selector: '[data-spector-id="' + id + '"]',
      coordinates: { x: Math.round(rect.x), y: Math.round(rect.y) },
      region: el.closest('header, nav, footer, [role="navigation"], [role="banner"], [role="contentinfo"]') ? 'chrome' : 'content'
    });
  });

  // Hasta 100 en orden del documento. Antes eran 40, y en una página de
  // categoría eran todos de la cabecera y los filtros: ningún producto.
  return {
    metaDescription: metaDescription,
    headings: headings,
    interactiveElements: interactiveElements.slice(0, 100)
  };
})()
`;

async function tagInteractiveElements(page: Page): Promise<void> {
  await page.evaluate(TAG_ELEMENTS_SCRIPT);
}

export async function captureState(page: Page): Promise<PageState> {
  await tagInteractiveElements(page);

  const url = page.url();
  const title = await page.title();

  const screenshotBuffer = await page.screenshot({
    fullPage: false,
    type: "jpeg",
    quality: 60,
  });
  const screenshot = `data:image/jpeg;base64,${screenshotBuffer.toString("base64")}`;

  const extracted = (await page.evaluate(EXTRACT_STATE_SCRIPT)) as {
    metaDescription: string;
    headings: string[];
    interactiveElements: InteractiveElement[];
  };

  return {
    url,
    title,
    metaDescription: extracted.metaDescription,
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
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
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

const buildFindElementScript = (label: string, type: string): string => `
(() => {
  const target = ${JSON.stringify(label)}.toLowerCase().trim();
  const type = ${JSON.stringify(type)};
  const candidates = [];

  // bag y basket valen lo mismo que cart: "Add to Cart" encuentra "Add to bag".
  const normalize = (s) => s.replace(/\\s+/g, ' ').trim().toLowerCase().replace(/\\b(bag|basket)\\b/g, 'cart');
  const stripNumbers = (s) => s.replace(/\\d+/g, '#').trim();

  const targetNorm = normalize(target);
  const targetStripped = stripNumbers(targetNorm);

  document.querySelectorAll('[data-spector-id]').forEach((el) => {
    const id = el.getAttribute('data-spector-id');
    const tag = el.tagName.toLowerCase();

    let elType;
    if (tag === 'a') elType = 'link';
    else if (tag === 'input' && el.type === 'submit') elType = 'button';
    else if (tag === 'input' || tag === 'textarea') elType = 'input';
    else elType = 'button';

    if (elType !== type) return;

    let elLabel = '';
    if (elType === 'input') {
      elLabel = el.getAttribute('placeholder') || el.getAttribute('aria-label') || el.getAttribute('name') || '';
    } else {
      elLabel = (el.textContent || '').trim() || el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('value') || '';
    }

    const a = normalize(elLabel);
    if (!a) return;

    const aStripped = stripNumbers(a);

    let score = -1;

    if (a === targetNorm) {
      score = 1000;
    } else if (aStripped === targetStripped) {
      score = 900;
    } else if (a.indexOf(targetNorm) === 0 || targetNorm.indexOf(a) === 0) {
      score = 700 - Math.abs(a.length - targetNorm.length);
    } else if (a.indexOf(targetNorm) !== -1) {
      score = 500 - Math.abs(a.length - targetNorm.length);
    } else if (targetNorm.indexOf(a) !== -1) {
      score = 400 - Math.abs(a.length - targetNorm.length);
    } else if (aStripped.indexOf(targetStripped) !== -1 || targetStripped.indexOf(aStripped) !== -1) {
      score = 300 - Math.abs(a.length - targetNorm.length);
    }

    if (score < 0) return;

    // Cobertura: qué parte de la etiqueta más larga comparten. "Search"
    // empieza igual que "search button", pero solo cubre la mitad.
    const coverage = Math.min(a.length, targetNorm.length) / Math.max(a.length, targetNorm.length);

    // ¿Es lo que de verdad se pulsa en su centro? Google tiene dos botones
    // "Buscar con Google" y uno queda tapado por el desplegable de
    // sugerencias: a igual puntaje gana el que está encima.
    const rect = el.getBoundingClientRect();
    const hitEl = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    const onTop = !!hitEl && (hitEl === el || el.contains(hitEl));

    candidates.push({ id: id, label: elLabel, norm: a, score: score, coverage: coverage, onTop: onTop });
  });

  if (candidates.length === 0) return null;
  candidates.sort((x, y) => y.score - x.score || (y.onTop ? 1 : 0) - (x.onTop ? 1 : 0));

  // Los mejores, uno por etiqueta: dos botones "Google Search" son el
  // mismo destino, no una ambigüedad.
  const seen = {};
  const top = [];
  candidates.forEach((c) => {
    if (top.length >= 5 || seen[c.norm]) return;
    seen[c.norm] = true;
    top.push({
      selector: '[data-spector-id="' + c.id + '"]',
      label: c.label.replace(/\\s+/g, ' ').trim().slice(0, 80),
      score: c.score,
      coverage: c.coverage
    });
  });
  return top;
})()
`;

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