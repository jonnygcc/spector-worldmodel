// Errores honestos (paso 9): qué pasó de verdad, con un mensaje corto para
// el cliente y el detalle en el log del servidor (regla del paso 1).
//
// - Un 429 de Gemini es cuota, nunca un timeout. Si Gemini dice cuándo
//   reintentar (RetryInfo.retryDelay), se respeta; si la cuota agotada es
//   la diaria, no se ofrece reintentar.
// - Un timeout es un timeout solo si no hubo antes un 429 que lo explique.
//
// Módulo sin dependencias: los tests lo cargan con `node --test`. Los
// errores de otros módulos se reconocen por su `name`.

export type FailureKind = "quota" | "timeout" | "overloaded" | "site" | "not-allowed" | "busy" | "cancelled" | "unknown";

// Lo que ve el cliente cuando algo falla.
export interface Failure {
  kind: FailureKind;
  message: string;
  // Puede reintentarse (el botón tiene sentido).
  retryable: boolean;
  // Segundos hasta que reintentar tenga sentido. Sin valor: ya.
  retryAfterSeconds?: number;
}

export const statusOf = (error: unknown): number | null => {
  const status = (error as { status?: unknown })?.status;
  return typeof status === "number" ? status : null;
};

// Cuota de Gemini agotada, con lo que se sabe de cuándo vuelve.
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

// ¿Es un 429 de cuota? El ApiError de @google/genai trae el status y, como
// mensaje, el cuerpo JSON de Gemini: RetryInfo.retryDelay ("37s") dice
// cuándo reintentar y QuotaFailure.violations[].quotaId si es la diaria.
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
    // Mensaje que no es JSON: se busca a mano.
    const delay = /retryDelay"?\s*[:=]\s*"?(\d+(?:\.\d+)?)s/.exec(message);
    if (delay) retryAfterMs = Math.round(Number.parseFloat(delay[1]) * 1000);
    daily = /PerDay/i.test(message);
  }
  return { retryAfterMs, daily };
}

// Errores que ninguna etapa debe tragarse para seguir con un valor por
// defecto: cuota agotada, plazo vencido o cliente desconectado. Si el
// re-sueño se tragara un 429, la ruta saldría "unreachable" en vez de
// decir que se agotó la cuota.
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

// Sin dato de Gemini, la cuota por minuto del free tier vuelve en un minuto.
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

// Con varios intentos fallidos (el World Model prueba más de una vez y con
// tiempo máximo): si alguno fue de cuota, manda la cuota, aunque después se
// acabara el tiempo. El timeout solo cuando no hubo 429. Si no, el último.
export function pickFailure(
  errors: unknown[],
  { timedOut = false, timeoutMessage = "The request took too long." } = {}
): Failure {
  const quota = errors.find((error) => quotaInfo(error) !== null);
  if (quota !== undefined) return describeFailure(quota);
  if (timedOut) return { kind: "timeout", message: timeoutMessage, retryable: true };
  return describeFailure(errors[errors.length - 1]);
}

// Cualquier error del análisis o de la predicción → lo que ve el cliente.
// `timedOut`: el plazo de quien llama venció (el World Model); solo cuenta
// si el error no es de cuota.
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
  // Errores de Playwright al cargar o navegar el sitio: net::ERR_…, o el
  // timeout de navegación.
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
