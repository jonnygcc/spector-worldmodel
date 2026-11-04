import type { PageState } from "./types";
import type { Route, RouteComparison } from "./goal-types";

// Built on the client from the agent result, without screenshots (the first state weighs several MB
// with them); /api/world-model truncates again just in case. No server deps, so the UI can use it.

export interface WorldModelInput {
  url: string;
  goal: string;
  pageContext: string;
  happyPath: string;
}

// A large homepage yields ~4000 characters within the element limits; the cap covers very long labels.
export const PAGE_CONTEXT_MAX = 8000;
export const HAPPY_PATH_MAX = 2000;

// What worldModelInputOf builds always fits (truncate adds at most its suffix); anything else is
// rejected before a model call is spent.
const TRUNCATED_SUFFIX = "\n… (truncated)";
export const MAX_WORLD_MODEL_FIELD = {
  url: 2048,
  goal: 500,
  pageContext: PAGE_CONTEXT_MAX + TRUNCATED_SUFFIX.length,
  happyPath: HAPPY_PATH_MAX + TRUNCATED_SUFFIX.length,
} as const;

export function validateWorldModelInput(
  body: unknown
): { ok: true; input: WorldModelInput } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "The request must be a JSON object." };
  }
  const fields = Object.keys(MAX_WORLD_MODEL_FIELD) as (keyof WorldModelInput)[];
  const unknown = Object.keys(body).filter((key) => !(fields as string[]).includes(key));
  if (unknown.length > 0) return { ok: false, error: `Unexpected field: ${unknown[0].slice(0, 40)}` };

  const input = body as Record<string, unknown>;
  for (const field of fields) {
    const value = input[field];
    if (typeof value !== "string") return { ok: false, error: `Missing or invalid field: ${field}` };
    if (value.length > MAX_WORLD_MODEL_FIELD[field]) return { ok: false, error: `The field ${field} is too long.` };
  }
  if (!(input.goal as string).trim()) return { ok: false, error: "A goal is required" };
  try {
    const { protocol } = new URL(input.url as string);
    if (protocol !== "http:" && protocol !== "https:") throw new Error();
  } catch {
    return { ok: false, error: "Invalid URL format" };
  }
  return { ok: true, input: input as unknown as WorldModelInput };
}

export const truncate = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max)}\n… (truncated)` : text;

// Content elements first, then header and footer: on a homepage the content ones lead to the goal.
export function compactPageContext(state: PageState): string {
  const content = state.interactiveElements.filter((el) => el.region !== "chrome").slice(0, 50);
  const chrome = state.interactiveElements.filter((el) => el.region === "chrome").slice(0, 30);
  const elements = [...content, ...chrome].map((el) => `- ${el.type}: "${el.label}"`).join("\n");
  const text = [
    `Title: ${state.title}`,
    state.headings.length ? `Headings:\n${state.headings.slice(0, 12).map((h) => `- ${h}`).join("\n")}` : "",
    `Interactive elements:\n${elements || "- (none captured)"}`,
  ]
    .filter(Boolean)
    .join("\n");
  return truncate(text, PAGE_CONTEXT_MAX);
}

// The recommended route, else the most likely executed one; path steps only. Says so when none ran.
export function happyPathOf(comparison: Pick<RouteComparison, "routes" | "bestRouteId">): string {
  const executed = comparison.routes.filter((r) => r.verified);
  const route: Route | undefined =
    executed.find((r) => r.id === comparison.bestRouteId) ??
    [...executed].sort((a, b) => b.probability - a.probability)[0];
  if (!route) return "None: the agent found no path to the goal on this page.";

  const steps = (route.stepResults ?? [])
    .filter((r) => !r.discarded)
    .map((r, i) => `${i + 1}. ${r.step.description}`);
  const outcome = route.outcome ? ` (outcome: ${route.outcome})` : "";
  const text = `${route.name ?? route.entryPoint}${outcome}\n${steps.join("\n") || "(no steps recorded)"}`;
  return truncate(text, HAPPY_PATH_MAX);
}

export function worldModelInputOf(result: RouteComparison): WorldModelInput {
  return {
    url: result.url,
    goal: result.goal.label,
    pageContext: compactPageContext(result.initialState),
    happyPath: happyPathOf(result),
  };
}
