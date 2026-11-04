// Límite de uso (paso 9): protege la cuota de Gemini del propio usuario, no
// repele tráfico masivo. Un análisis hace unas 13 llamadas al modelo y el
// free tier permite 15 por minuto: dos análisis en paralelo ya la agotan.
//
// Estado en memoria del proceso del servidor: Spector corre en local con
// un solo servidor.
//
// Módulo sin dependencias: los tests lo cargan con `node --test`.

export interface LimitConfig {
  maxConcurrent: number;
  maxPerWindow: number;
  windowMs: number;
  // Para los mensajes: "analysis", "prediction".
  noun: string;
}

export type Acquired =
  | { ok: true; release: () => void }
  | { ok: false; reason: "busy" | "window"; message: string; retryAfterSeconds: number };

// Mientras hay uno en curso, otro espera unos segundos antes de reintentar.
const BUSY_RETRY_S = 10;

export function createLimiter(config: LimitConfig) {
  let running = 0;
  const starts: number[] = [];

  return {
    acquire(now = Date.now()): Acquired {
      while (starts.length > 0 && now - starts[0] >= config.windowMs) starts.shift();
      if (running >= config.maxConcurrent) {
        return {
          ok: false,
          reason: "busy",
          message: `Another ${config.noun} is already running. Wait for it to finish.`,
          retryAfterSeconds: BUSY_RETRY_S,
        };
      }
      if (starts.length >= config.maxPerWindow) {
        const retryAfterSeconds = Math.max(1, Math.ceil((starts[0] + config.windowMs - now) / 1000));
        const minutes = Math.round(config.windowMs / 60_000);
        return {
          ok: false,
          reason: "window",
          message: `Spector ran ${config.maxPerWindow} ${config.noun === "analysis" ? "analyses" : `${config.noun}s`} in the last ${minutes} minutes, to protect your Gemini quota. Try again in ${retryAfterSeconds} seconds.`,
          retryAfterSeconds,
        };
      }
      running += 1;
      starts.push(now);
      let released = false;
      return {
        ok: true,
        release: () => {
          if (released) return;
          released = true;
          running -= 1;
        },
      };
    },
    get running() {
      return running;
    },
  };
}

export type Limiter = ReturnType<typeof createLimiter>;

// Los de la app. Un análisis a la vez y 6 cada 10 minutos (~80 llamadas al
// modelo). La predicción del World Model es una llamada: una a la vez y 15
// cada 10 minutos (cubre los Retry).
export const ANALYSIS_LIMIT: LimitConfig = { maxConcurrent: 1, maxPerWindow: 6, windowMs: 10 * 60_000, noun: "analysis" };
export const PREDICTION_LIMIT: LimitConfig = { maxConcurrent: 1, maxPerWindow: 15, windowMs: 10 * 60_000, noun: "prediction" };
