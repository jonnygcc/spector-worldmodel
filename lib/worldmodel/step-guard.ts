import type { NavigationExpectation, RouteStep } from "./goal-types";

// The model picks what to click and type, and a page may try to steer it, so this bounds what it can
// ask for. No runtime deps (types only), for `node --test`.

export const STEP_TYPES = ["click", "type", "press", "scroll"] as const;
export const TARGET_TYPES = ["button", "link", "input"] as const;

// Submit, close, move through a list. No shortcuts or key combinations.
export const ALLOWED_KEYS = ["Enter", "Escape", "Tab", "ArrowDown", "ArrowUp"] as const;

// An email, a search, a name; anything longer is truncated.
export const MAX_TYPED_VALUE = 100;
const MAX_DESCRIPTION = 200;
const MAX_TARGET = 120;
const MAX_HINT = 100;
const MAX_SIGNAL = 60;

const clip = (text: string, max: number) => text.replace(/\s+/g, " ").trim().slice(0, max);
const isOneOf = <T extends string>(list: readonly T[], value: unknown): value is T =>
  typeof value === "string" && (list as readonly string[]).includes(value);

// null if the step can't run as it came: unknown type, a key outside the list, or click/type with no element.
export function sanitizeStep(raw: Partial<RouteStep> | null | undefined, order: number): RouteStep | null {
  if (!raw || !isOneOf(STEP_TYPES, raw.type)) return null;
  const type = raw.type;

  const targetElement = typeof raw.targetElement === "string" ? clip(raw.targetElement, MAX_TARGET) : "";
  if ((type === "click" || type === "type") && !targetElement) return null;

  let value: string | undefined;
  if (type === "press") {
    if (!isOneOf(ALLOWED_KEYS, raw.value ?? "Enter")) return null;
    value = raw.value ?? "Enter";
  } else if (type === "type") {
    value = typeof raw.value === "string" ? raw.value.slice(0, MAX_TYPED_VALUE) : "";
  }

  const nav: NavigationExpectation =
    raw.navigationExpected === "navigate" || raw.navigationExpected === "same-page" ? raw.navigationExpected : "unknown";
  const hint =
    typeof raw.expectedUrlHint === "string" && raw.expectedUrlHint.trim() ? clip(raw.expectedUrlHint, MAX_HINT) : null;
  const signals = Array.isArray(raw.expectedSignals)
    ? raw.expectedSignals
        .filter((x): x is string => typeof x === "string" && x.trim() !== "")
        .map((x) => clip(x, MAX_SIGNAL))
        .slice(0, 3)
    : [];

  return {
    order,
    type,
    description: typeof raw.description === "string" ? clip(raw.description, MAX_DESCRIPTION) : "",
    targetElement,
    targetType: isOneOf(TARGET_TYPES, raw.targetType) ? raw.targetType : "button",
    value,
    navigationExpected: nav,
    expectedUrlHint: hint,
    expectedSignals: signals,
  };
}

// Invalid steps are dropped, not guessed at.
export function sanitizeSteps(raw: unknown, max: number): RouteStep[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((step, i) => sanitizeStep(step as Partial<RouteStep>, i + 1))
    .filter((step): step is RouteStep => step !== null)
    .slice(0, max)
    .map((step, i) => ({ ...step, order: i + 1 }));
}

// No public suffix list: same host or one a subdomain of the other (without "www."). A login on another
// domain cuts the route, the price of never letting a page send the agent elsewhere.
export function siteHost(url: string): string | null {
  try {
    const { protocol, hostname } = new URL(url);
    if (protocol !== "http:" && protocol !== "https:") return null;
    return hostname.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function sameSite(siteUrl: string, url: string): boolean {
  const a = siteHost(siteUrl);
  const b = siteHost(url);
  if (!a || !b) return false;
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}
