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
  let counter = 0;

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
      coordinates: { x: Math.round(rect.x), y: Math.round(rect.y) }
    });
  });

  return {
    metaDescription: metaDescription,
    headings: headings,
    interactiveElements: interactiveElements.slice(0, 40)
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
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(1200);
  const state = await captureState(page);
  return { browser, page, state };
}

const buildFindElementScript = (label: string, type: string): string => `
(() => {
  const target = ${JSON.stringify(label)}.toLowerCase().trim();
  const type = ${JSON.stringify(type)};
  const candidates = [];

  const normalize = (s) => s.replace(/\\s+/g, ' ').trim().toLowerCase();
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

    candidates.push({ id: id, label: elLabel, score: score });
  });

  if (candidates.length === 0) return null;
  candidates.sort((x, y) => y.score - x.score);
  return '[data-spector-id="' + candidates[0].id + '"]';
})()
`;

export async function retagAndFindElement(
  page: Page,
  targetLabel: string,
  targetType: InteractiveElement["type"]
): Promise<string | null> {
  await tagInteractiveElements(page);

  const script = buildFindElementScript(targetLabel, targetType);
  const selector = (await page.evaluate(script)) as string | null;

  return selector;
}