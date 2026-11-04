// Protects the user's own Gemini quota, not against mass traffic: an analysis makes ~13 calls and the
// free tier allows 15 per minute. In-memory state: Spector runs locally on a single server.

export interface LimitConfig {
  maxConcurrent: number;
  maxPerWindow: number;
  windowMs: number;
  // For messages: "analysis", "prediction".
  noun: string;
}

export type Acquired =
  | { ok: true; release: () => void }
  | { ok: false; reason: "busy" | "window"; message: string; retryAfterSeconds: number };

// While one is running, the next waits a few seconds before retrying.
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

// One analysis at a time and 6 per 10 minutes (~80 model calls). A prediction is one call: one at a
// time and 15 per 10 minutes, which covers Retry.
export const ANALYSIS_LIMIT: LimitConfig = { maxConcurrent: 1, maxPerWindow: 6, windowMs: 10 * 60_000, noun: "analysis" };
export const PREDICTION_LIMIT: LimitConfig = { maxConcurrent: 1, maxPerWindow: 15, windowMs: 10 * 60_000, noun: "prediction" };
