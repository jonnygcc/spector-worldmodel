// A Gemini 429 is quota, never a timeout. Short message to the client, details in the log. No
// dependencies so `node --test` can load it; other modules' errors are matched by `name`.

export type FailureKind = "quota" | "timeout" | "overloaded" | "site" | "not-allowed" | "busy" | "cancelled" | "unknown";

// What the client sees when something fails.
export interface Failure {
  kind: FailureKind;
  message: string;
  // Whether a retry button makes sense.
  retryable: boolean;
  // Seconds until retrying makes sense; absent means now.
  retryAfterSeconds?: number;
}

export const statusOf = (error: unknown): number | null => {
  const status = (error as { status?: unknown })?.status;
  return typeof status === "number" ? status : null;
};

// Gemini quota exhausted, with whatever is known about when it comes back.
export class ModelQuotaError extends Error {
  readonly retryAfterMs: number | null;
  readonly daily: boolean;

  constructor(retryAfterMs: number | null, daily: boolean) {
    super(daily ? "Gemini daily quota exhausted" : "Gemini rate limit reached");
    this.name = "ModelQuotaError";
    this.retryAfterMs = retryAfterMs;
    this.daily = daily;
  }
}

// @google/genai's ApiError carries the status, with Gemini's JSON body as its message: RetryInfo
// says when to retry and QuotaFailure.quotaId whether it's the daily quota.
export function quotaInfo(error: unknown): { retryAfterMs: number | null; daily: boolean } | null {
  if (error instanceof ModelQuotaError) return { retryAfterMs: error.retryAfterMs, daily: error.daily };
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (statusOf(error) !== 429 && !/RESOURCE_EXHAUSTED|"code":\s*429/.test(message)) return null;

  let retryAfterMs: number | null = null;
  let daily = false;
  try {
    const body = JSON.parse(message) as {
      error?: { details?: { "@type"?: string; retryDelay?: string; violations?: { quotaId?: string }[] }[] };
    };
    for (const detail of body.error?.details ?? []) {
      if (detail["@type"]?.endsWith("RetryInfo") && typeof detail.retryDelay === "string") {
        const seconds = Number.parseFloat(detail.retryDelay);
        if (Number.isFinite(seconds) && seconds >= 0) retryAfterMs = Math.round(seconds * 1000);
      }
      if (detail["@type"]?.endsWith("QuotaFailure")) {
        daily ||= (detail.violations ?? []).some((v) => /per ?day/i.test(v.quotaId ?? ""));
      }
    }
  } catch {
    // Not JSON: search the text instead.
    const delay = /retryDelay"?\s*[:=]\s*"?(\d+(?:\.\d+)?)s/.exec(message);
    if (delay) retryAfterMs = Math.round(Number.parseFloat(delay[1]) * 1000);
    daily = /PerDay/i.test(message);
  }
  return { retryAfterMs, daily };
}

// No stage may swallow these and carry on with a default: a swallowed 429 in the re-plan turned the
// route "unreachable" instead of reporting the quota.
export function mustPropagate(error: unknown): boolean {
  const name = (error as { name?: unknown })?.name;
  return (
    quotaInfo(error) !== null ||
    name === "AnalysisTimeoutError" ||
    name === "AnalysisCancelledError" ||
    name === "AbortError"
  );
}

const firstLine = (error: unknown) =>
  (error instanceof Error ? error.message : String(error ?? "")).split("\n")[0].trim();

// Without Gemini's hint, the free tier's per-minute quota resets within a minute.
const DEFAULT_QUOTA_WAIT_S = 60;
const OVERLOADED_WAIT_S = 15;

export function quotaFailure(retryAfterMs: number | null, daily: boolean): Failure {
  if (daily) {
    return {
      kind: "quota",
      message: "The daily Gemini quota for this API key is used up. Try again tomorrow.",
      retryable: false,
    };
  }
  const seconds = retryAfterMs === null ? DEFAULT_QUOTA_WAIT_S : Math.max(1, Math.ceil(retryAfterMs / 1000));
  return {
    kind: "quota",
    message: `The Gemini rate limit for this API key was reached. Try again in ${seconds} seconds.`,
    retryable: true,
    retryAfterSeconds: seconds,
  };
}

// With several attempts (the World Model retries under a deadline), a quota error wins even if time
// ran out later; timeout only applies when there was no 429.
export function pickFailure(
  errors: unknown[],
  { timedOut = false, timeoutMessage = "The request took too long." } = {}
): Failure {
  const quota = errors.find((error) => quotaInfo(error) !== null);
  if (quota !== undefined) return describeFailure(quota);
  if (timedOut) return { kind: "timeout", message: timeoutMessage, retryable: true };
  return describeFailure(errors[errors.length - 1]);
}

// `timedOut`: the caller's deadline expired; only counts when the error isn't quota.
export function describeFailure(error: unknown, { timedOut = false, timeoutMessage = "" } = {}): Failure {
  const quota = quotaInfo(error);
  if (quota) return quotaFailure(quota.retryAfterMs, quota.daily);

  const name = (error as { name?: unknown })?.name;
  if (name === "AnalysisCancelledError") {
    return { kind: "cancelled", message: "The analysis was cancelled.", retryable: true };
  }
  if (timedOut || name === "AnalysisTimeoutError") {
    return { kind: "timeout", message: timeoutMessage || firstLine(error), retryable: true };
  }
  if (name === "UrlNotAllowedError") {
    return { kind: "not-allowed", message: firstLine(error), retryable: false };
  }
  const status = statusOf(error);
  if (status !== null && status >= 500) {
    return {
      kind: "overloaded",
      message: "The model is overloaded right now. Try again in a moment.",
      retryable: true,
      retryAfterSeconds: OVERLOADED_WAIT_S,
    };
  }
  // Playwright errors while loading or navigating the site: net::ERR_…, or the navigation timeout.
  const line = firstLine(error);
  const net = /net::ERR_[A-Z_]+/.exec(line);
  if (net) return { kind: "site", message: `The site couldn't be loaded (${net[0]}).`, retryable: true };
  if (name === "TimeoutError" || /Timeout \d+ms exceeded/.test(line)) {
    return { kind: "site", message: "The site took too long to respond.", retryable: true };
  }
  if (/did not respond within/.test(line)) {
    return { kind: "site", message: "The site stopped responding.", retryable: true };
  }
  return { kind: "unknown", message: "Something went wrong during the analysis. Try again.", retryable: true };
}
