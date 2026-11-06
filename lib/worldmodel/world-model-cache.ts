import { createHash } from "node:crypto";
import type { WMScenario } from "./report-contract";
import type { WorldModelInput } from "./world-model-input";

// The model varies with an identical input (20, then 65 for one scenario), so the first answer for a page
// stands. In-memory state, like usage-limit.ts: Spector runs locally on a single server.

export const MAX_PREDICTIONS = 200;

export interface StoredPrediction {
  ok: true;
  scenarios: WMScenario[];
  model: string;
}

// happyPath stays out: the model rewords the same route on every run, so it would never match.
const keyOf = ({ url, goal, pageContext }: WorldModelInput) =>
  createHash("sha256").update(JSON.stringify([url, goal, pageContext])).digest("hex");

export function createPredictionCache(max = MAX_PREDICTIONS) {
  const stored = new Map<string, StoredPrediction>();

  return {
    get: (input: WorldModelInput) => stored.get(keyOf(input)) ?? null,
    // Failures and empty answers stay out, so Retry can still ask again.
    remember(input: WorldModelInput, outcome: { ok: boolean; scenarios?: WMScenario[]; model?: string }) {
      if (!outcome.ok || !outcome.scenarios?.length) return;
      stored.set(keyOf(input), { ok: true, scenarios: outcome.scenarios, model: outcome.model ?? "" });
      if (stored.size > max) stored.delete(stored.keys().next().value as string);
    },
    get size() {
      return stored.size;
    },
  };
}
