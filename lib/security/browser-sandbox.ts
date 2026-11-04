import { AsyncLocalStorage } from "node:async_hooks";
import { chromium, type Browser, type Page } from "playwright-core";

// El navegador frente a una página hostil (paso 8): una página puede
// colgarse, abrir popups, pedir permisos, lanzar diálogos que bloquean,
// descargar archivos o navegar sin fin. Aquí está todo lo que acota eso.
// El tráfico de red lo controla el proxy de url-guard.ts.
//
// Módulo sin importaciones relativas: los tests lo cargan con `node --test`.

// ============================================================
// Límites
// ============================================================
// Carga de una página (goto, y las navegaciones que dispara un clic).
export const NAVIGATION_TIMEOUT_MS = 30_000;
// Acciones de Playwright (click, fill, screenshot…).
export const ACTION_TIMEOUT_MS = 10_000;
// Un script dentro de la página. page.evaluate no tiene timeout propio:
// una página con `while (true) {}` lo dejaría esperando para siempre.
export const EVALUATE_TIMEOUT_MS = 10_000;
// El análisis entero, por debajo del maxDuration (300 s) de la ruta.
export const ANALYSIS_TIMEOUT_MS = 240_000;
// Navegaciones del marco principal por página. Una ruta real hace unas
// pocas por paso (redirecciones incluidas); una página que se recarga o
// salta sola sin parar se corta aquí.
export const MAX_NAVIGATIONS_PER_PAGE = 30;
// Texto de la página que se trae al servidor para comparar estados.
export const MAX_PAGE_TEXT = 100_000;

// Sin prompts de permisos: cámara, micrófono, ubicación, notificaciones,
// portapapeles… se deniegan sin preguntar.
export const SANDBOX_ARGS = ["--deny-permission-prompts"];

// ============================================================
// Ruta de Chromium
// ============================================================
// SPECTOR_CHROMIUM_PATH si está definida; si no, la que instala
// playwright-core para su versión (`npx playwright-core install chromium`).
export function resolveChromiumPath(): string {
  return process.env.SPECTOR_CHROMIUM_PATH || chromium.executablePath();
}

// ============================================================
// Página aislada
// ============================================================
// Cada página del análisis en un contexto nuevo: sin cookies, storage ni
// caché de otra página o de otro análisis. Cerrar la página cierra su
// contexto.
export async function newSandboxedPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({
    acceptDownloads: false,
    permissions: [],
    serviceWorkers: "block",
  });
  context.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
  context.setDefaultTimeout(ACTION_TIMEOUT_MS);

  const page = await context.newPage();

  // Popups (window.open, target="_blank"): se cierran al abrirse. El
  // agente solo actúa en su página.
  context.on("page", (popup) => {
    if (popup !== page) void popup.close().catch(() => {});
  });
  // alert, confirm, prompt y beforeunload: se descartan. Con un listener
  // registrado Playwright ya no los descarta solo, así que es explícito.
  page.on("dialog", (dialog) => void dialog.dismiss().catch(() => {}));
  // Una página que navega sola sin parar: se cierra.
  let navigations = 0;
  page.on("framenavigated", (frame) => {
    if (frame !== page.mainFrame()) return;
    navigations += 1;
    if (navigations > MAX_NAVIGATIONS_PER_PAGE) {
      console.warn(`[Browser] More than ${MAX_NAVIGATIONS_PER_PAGE} navigations on one page: closing it.`);
      void context.close().catch(() => {});
    }
  });
  page.on("close", () => void context.close().catch(() => {}));
  return page;
}

// Cualquier promesa de Playwright con tope de tiempo.
export async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    promise.catch(() => {});
  }
}

// page.evaluate con tope.
export function evaluateWithTimeout<T>(page: Page, script: string, ms = EVALUATE_TIMEOUT_MS): Promise<T> {
  return withTimeout(page.evaluate(script) as Promise<T>, ms, `The page did not respond within ${ms / 1000} seconds.`);
}

// ============================================================
// Plazo del análisis y cierre garantizado
// ============================================================
// Cada análisis corre dentro de una sesión (AsyncLocalStorage): los
// navegadores que lanza quedan registrados en ella. Al vencer el plazo se
// cierran todos (lo que esté esperando a la página falla en el acto), y al
// terminar, bien o mal, se cierra lo que quede abierto.
interface Session {
  browsers: Set<Browser>;
  expired: boolean;
}
const sessions = new AsyncLocalStorage<Session>();

export class AnalysisTimeoutError extends Error {
  constructor(ms: number) {
    super(`The analysis took longer than ${Math.round(ms / 1000)} seconds and was stopped.`);
    this.name = "AnalysisTimeoutError";
  }
}

const closeAll = (session: Session) =>
  Promise.all([...session.browsers].map((browser) => browser.close().catch(() => {})));

// Registra un navegador en la sesión del análisis en curso. Si el plazo
// ya venció, lo cierra y falla.
export async function trackBrowser(browser: Browser): Promise<Browser> {
  const session = sessions.getStore();
  if (!session) return browser;
  if (session.expired) {
    await browser.close().catch(() => {});
    throw new AnalysisTimeoutError(ANALYSIS_TIMEOUT_MS);
  }
  session.browsers.add(browser);
  browser.on("disconnected", () => session.browsers.delete(browser));
  return browser;
}

// Falla si el plazo del análisis en curso ya venció: se llama entre etapas
// para no seguir gastando llamadas al modelo.
export function checkDeadline(): void {
  if (sessions.getStore()?.expired) throw new AnalysisTimeoutError(ANALYSIS_TIMEOUT_MS);
}

export async function withAnalysisDeadline<T>(run: () => Promise<T>, ms = ANALYSIS_TIMEOUT_MS): Promise<T> {
  const session: Session = { browsers: new Set(), expired: false };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      session.expired = true;
      void closeAll(session);
      reject(new AnalysisTimeoutError(ms));
    }, ms);
  });
  const work = sessions.run(session, run);
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
    work.catch(() => {});
    await closeAll(session);
  }
}

// Cuántos navegadores siguen abiertos en la sesión en curso (tests).
export const openBrowsers = (): number => sessions.getStore()?.browsers.size ?? 0;
