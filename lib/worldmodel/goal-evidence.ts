import type { Route } from "./goal-types";

// Signals come from the goal alone, before the visit; code looks for them on the final page, and a
// route the model calls arrived without any is UNVERIFIED. No runtime deps, for `node --test`.

export interface GoalSignals {
  // Visible texts that appear once the goal is met.
  text: string[];
  // URL path fragments where it's usually met ("/pricing").
  url: string[];
}

export const NO_SIGNALS: GoalSignals = { text: [], url: [] };

const MAX_TEXT_SIGNALS = 8;
const MAX_URL_HINTS = 5;
const MAX_SIGNAL = 40;

const normalize = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
const occurrences = (text: string, needle: string) => (needle ? text.split(needle).length - 1 : 0);

// Short, non-empty, unique strings.
export function normalizeSignals(raw: unknown): GoalSignals {
  const list = (value: unknown, max: number) =>
    Array.isArray(value)
      ? [
          ...new Set(
            value
              .filter((x): x is string => typeof x === "string")
              .map((x) => normalize(x).slice(0, MAX_SIGNAL))
              .filter((x) => x.length >= 2)
          ),
        ].slice(0, max)
      : [];
  const r = (raw ?? {}) as { textSignals?: unknown; urlHints?: unknown };
  return { text: list(r.textSignals, MAX_TEXT_SIGNALS), url: list(r.urlHints, MAX_URL_HINTS) };
}

export interface GoalEvidence {
  verified: boolean;
  found: string[];
}

// A text signal only counts if it appears more often than on the start page: "Pricing" sits in
// every header and proves nothing.
export function checkGoalEvidence(
  signals: GoalSignals,
  initialText: string,
  finalText: string,
  finalUrl: string
): GoalEvidence {
  const before = normalize(initialText);
  const after = normalize(finalText);
  let path = "";
  try {
    const url = new URL(finalUrl);
    path = `${url.pathname}${url.search}`.toLowerCase();
  } catch {
    // Without a readable URL only text signals count.
  }
  const found = [
    ...signals.url.filter((hint) => path.includes(hint)),
    ...signals.text.filter((signal) => occurrences(after, signal) > occurrences(before, signal)),
  ];
  return { verified: found.length > 0, found };
}

// Whatever the comparator proposes is ignored unless the route ran, arrived and was verified.
export function pickBestRouteId(
  routes: Pick<Route, "id" | "verified" | "outcome" | "goalVerified">[],
  proposedId: string | null | undefined
): string | null {
  const best = routes.find((r) => r.id === proposedId);
  return best && best.verified && best.outcome === "reached" && best.goalVerified === true ? best.id : null;
}
