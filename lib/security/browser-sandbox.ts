import { AsyncLocalStorage } from "node:async_hooks";
import { chromium, type Browser, type Page } from "playwright-core";

// Bounds what a hostile page can do to the browser (hangs, popups, permissions, dialogs, downloads,
// endless navigation); network egress is url-guard.ts's job. No relative imports, for `node --test`.

// Page load: goto and the navigations a click triggers.
export const NAVIGATION_TIMEOUT_MS = 30_000;
// Playwright actions (click, fill, screenshot…).
export const ACTION_TIMEOUT_MS = 10_000;
// page.evaluate has no timeout of its own: a page running `while (true) {}` would hang it forever.
export const EVALUATE_TIMEOUT_MS = 10_000;
// The whole analysis, under the route's maxDuration (300 s).
export const ANALYSIS_TIMEOUT_MS = 240_000;
// A real route makes a few navigations per step (redirects included); a page that reloads or jumps
// by itself forever gets cut here.
export const MAX_NAVIGATIONS_PER_PAGE = 30;
// Page text brought back to the server to compare states.
export const MAX_PAGE_TEXT = 100_000;

// No permission prompts: camera, microphone, location, notifications, clipboard… are denied.
export const SANDBOX_ARGS = ["--deny-permission-prompts"];

// Falls back to the build playwright-core installs for its version (npx playwright-core install chromium).
export function resolveChromiumPath(): string {
  return process.env.SPECTOR_CHROMIUM_PATH || chromium.executablePath();
}

// A fresh context per page: no cookies, storage or cache from another page or analysis.
export async function newSandboxedPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({
    acceptDownloads: false,
    permissions: [],
    serviceWorkers: "block",
  });
  context.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
  context.setDefaultTimeout(ACTION_TIMEOUT_MS);

  const page = await context.newPage();

  // Popups (window.open, target="_blank") close on open: the agent only acts on its own page.
  context.on("page", (popup) => {
    if (popup !== page) void popup.close().catch(() => {});
  });
  // Once a listener is registered Playwright stops auto-dismissing dialogs, so it's done explicitly.
  page.on("dialog", (dialog) => void dialog.dismiss().catch(() => {}));
  // A page that keeps navigating by itself gets closed.
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

// Any Playwright promise, with a time cap.
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

// page.evaluate with a time cap.
export function evaluateWithTimeout<T>(page: Page, script: string, ms = EVALUATE_TIMEOUT_MS): Promise<T> {
  return withTimeout(page.evaluate(script) as Promise<T>, ms, `The page did not respond within ${ms / 1000} seconds.`);
}

// Each analysis runs in a session (AsyncLocalStorage) that tracks its browsers and feeds its signal to
// model calls; a deadline or disconnect aborts and closes everything, so no browser is ever left open.
interface Session {
  browsers: Set<Browser>;
  controller: AbortController;
  // The error it ended early with, or null while it's still running.
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

// The running analysis's AbortSignal, for model calls.
export const currentAnalysisSignal = (): AbortSignal | undefined => sessions.getStore()?.controller.signal;

// If the session already ended (deadline or cancel), the browser is closed and this throws.
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

// Called between stages so an analysis that already ended doesn't keep spending model calls.
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

// Browsers still open in the current session (for tests).
export const openBrowsers = (): number => sessions.getStore()?.browsers.size ?? 0;
