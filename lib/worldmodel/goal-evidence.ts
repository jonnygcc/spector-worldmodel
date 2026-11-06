import type { Route } from "./goal-types";

// Structural signals work in any language, so they decide first; text is only the fallback. The model
// never sees page content here, and code does the checking. No runtime deps, for `node --test`.

export const STRUCTURAL_SIGNALS = ["password_field", "email_field", "form", "payment_field", "new_inputs"] as const;
export type StructuralSignal = (typeof STRUCTURAL_SIGNALS)[number];

export interface GoalSignals {
  // URL path fragments where the goal is usually met ("/pricing").
  url: string[];
  structure: StructuralSignal[];
  // Visible texts in the site's language, only consulted when the structural checks find nothing.
  text: string[];
}

export const NO_SIGNALS: GoalSignals = { url: [], structure: [], text: [] };

// Counts, not yes/no: a second form on the final page is still new.
export interface PageStructure {
  password: number;
  email: number;
  forms: number;
  payment: number;
  inputs: number;
}

export const NO_STRUCTURE: PageStructure = { password: 0, email: 0, forms: 0, payment: 0, inputs: 0 };

const STRUCTURE_KEY: Record<StructuralSignal, keyof PageStructure> = {
  password_field: "password",
  email_field: "email",
  form: "forms",
  payment_field: "payment",
  new_inputs: "inputs",
};

export interface PageEvidence {
  url: string;
  text: string;
  structure: PageStructure;
}

const MAX_TEXT_SIGNALS = 8;
const MAX_URL_HINTS = 8;
const MAX_SIGNAL = 40;

const normalize = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
const occurrences = (text: string, needle: string) => (needle ? text.split(needle).length - 1 : 0);

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
  const r = (raw ?? {}) as { textSignals?: unknown; urlHints?: unknown; structuralSignals?: unknown };
  const structure = STRUCTURAL_SIGNALS.filter(
    (signal) => Array.isArray(r.structuralSignals) && r.structuralSignals.includes(signal)
  );
  return { url: list(r.urlHints, MAX_URL_HINTS), structure, text: list(r.textSignals, MAX_TEXT_SIGNALS) };
}

export interface GoalEvidence {
  verified: boolean;
  found: string[];
  via: "structure" | "text" | null;
}

function pathOf(url: string): string {
  try {
    const { pathname, search } = new URL(url);
    return `${pathname}${search}`.toLowerCase();
  } catch {
    return "";
  }
}

// Nothing already on the start page counts: "Pricing" sits in every header, a newsletter box is an
// email field, and analyzing /pricing itself proves nothing about arriving there.
export function checkGoalEvidence(signals: GoalSignals, initial: PageEvidence, final: PageEvidence): GoalEvidence {
  const before = pathOf(initial.url);
  const after = pathOf(final.url);
  const structural = [
    ...signals.url.filter((hint) => after.includes(hint) && !before.includes(hint)),
    ...signals.structure.filter((signal) => {
      const key = STRUCTURE_KEY[signal];
      return final.structure[key] > initial.structure[key];
    }),
  ];
  if (structural.length > 0) return { verified: true, found: structural, via: "structure" };

  const textBefore = normalize(initial.text);
  const textAfter = normalize(final.text);
  const text = signals.text.filter((signal) => occurrences(textAfter, signal) > occurrences(textBefore, signal));
  return text.length > 0 ? { verified: true, found: text, via: "text" } : { verified: false, found: [], via: null };
}

// Whatever the comparator proposes is ignored unless the route ran, arrived and was verified.
export function pickBestRouteId(
  routes: Pick<Route, "id" | "verified" | "outcome" | "goalVerified">[],
  proposedId: string | null | undefined
): string | null {
  const best = routes.find((r) => r.id === proposedId);
  return best && best.verified && best.outcome === "reached" && best.goalVerified === true ? best.id : null;
}
