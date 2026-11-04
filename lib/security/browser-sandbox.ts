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
// navegadores que lanza quedan registrados en ella, y su AbortSignal llega
// a las llamadas al modelo (gemini.ts). La sesión termina de tres formas:
// - vence el plazo (AnalysisTimeoutError);
// - el cliente se desconecta (`signal` de fuera, AnalysisCancelledError):
//   cerró la pestaña, y nadie va a leer el resultado (paso 9);
// - el análisis acaba, bien o mal.
// En los dos primeros casos se abortan las llamadas en curso y se cierran
// todos los navegadores, así que lo que esté esperando falla en el acto.
// En todos, al final no queda ningún navegador abierto.
interface Session {
  browsers: Set<Browser>;
  controller: AbortController;
  // El error con el que terminó antes de tiempo, o null mientras sigue.
  ended: Error | null;
}
const sessions = new AsyncLocalStorage<Session>();

export class AnalysisTimeoutError extends Error {
  constructor(ms: number) {
    super(`The analysis took longer than ${Math.round(ms / 1000)} seconds and was stopped.`);
    this.name = "AnalysisTimeoutError";
  }
}

export class AnalysisCancelledError extends Error {
  constructor() {
    super("The analysis was cancelled: the client disconnected.");
    this.name = "AnalysisCancelledError";
  }
}

const closeAll = (session: Session) =>
  Promise.all([...session.browsers].map((browser) => browser.close().catch(() => {})));

// El AbortSignal del análisis en curso, para las llamadas al modelo.
export const currentAnalysisSignal = (): AbortSignal | undefined => sessions.getStore()?.controller.signal;

// Registra un navegador en la sesión del análisis en curso. Si la sesión
// ya terminó (plazo o cancelación), lo cierra y falla.
export async function trackBrowser(browser: Browser): Promise<Browser> {
  const session = sessions.getStore();
  if (!session) return browser;
  if (session.ended) {
    await browser.close().catch(() => {});
    throw session.ended;
  }
  session.browsers.add(browser);
  browser.on("disconnected", () => session.browsers.delete(browser));
  return browser;
}

// Falla si el análisis en curso ya terminó (plazo o cancelación): se llama
// entre etapas para no seguir gastando llamadas al modelo.
export function checkDeadline(): void {
  const ended = sessions.getStore()?.ended;
  if (ended) throw ended;
}

export async function withAnalysisDeadline<T>(
  run: () => Promise<T>,
  ms = ANALYSIS_TIMEOUT_MS,
  signal?: AbortSignal
): Promise<T> {
  // Otherwise `run` would start in the background and spend model calls after we reject.
  if (signal?.aborted) throw new AnalysisCancelledError();
  const session: Session = { browsers: new Set(), controller: new AbortController(), ended: null };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;

  const stopped = new Promise<never>((_, reject) => {
    const end = (error: Error) => {
      if (session.ended) return;
      session.ended = error;
      session.controller.abort(error);
      void closeAll(session);
      reject(error);
    };
    timer = setTimeout(() => end(new AnalysisTimeoutError(ms)), ms);
    onAbort = () => end(new AnalysisCancelledError());
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
  });
  stopped.catch(() => {});

  const work = sessions.run(session, run);
  try {
    return await Promise.race([work, stopped]);
  } finally {
    clearTimeout(timer);
    if (onAbort) signal?.removeEventListener("abort", onAbort);
    work.catch(() => {});
    await closeAll(session);
  }
}

// Cuántos navegadores siguen abiertos en la sesión en curso (tests).
export const openBrowsers = (): number => sessions.getStore()?.browsers.size ?? 0;
