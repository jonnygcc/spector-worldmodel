import type { PageState } from "./types";
import type { Route, RouteComparison } from "./goal-types";

// Entrada del World Model, ya compacta. Se arma en el cliente a partir del
// resultado del agente (sin capturas: el primer estado pesa varios MB con
// ellas) y se manda a /api/world-model, que la vuelve a recortar por si
// acaso. Módulo sin dependencias de servidor, para que lo use la UI.

export interface WorldModelInput {
  url: string;
  goal: string;
  pageContext: string;
  happyPath: string;
}

// Topes de caracteres. Una portada grande da ~4000 caracteres con los
// límites de elementos; el tope cubre páginas con etiquetas muy largas.
export const PAGE_CONTEXT_MAX = 8000;
export const HAPPY_PATH_MAX = 2000;

export const truncate = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max)}\n… (truncated)` : text;

// El primer estado sin HTML: título, descripción, encabezados y los
// elementos interactivos, primero los del contenido y luego cabecera y
// pie (en una portada, los del contenido son los que llevan al objetivo).
export function compactPageContext(state: PageState): string {
  const content = state.interactiveElements.filter((el) => el.region !== "chrome").slice(0, 50);
  const chrome = state.interactiveElements.filter((el) => el.region === "chrome").slice(0, 30);
  const elements = [...content, ...chrome].map((el) => `- ${el.type}: "${el.label}"`).join("\n");
  const text = [
    `Title: ${state.title}`,
    state.metaDescription ? `Description: ${state.metaDescription}` : "",
    state.headings.length ? `Headings:\n${state.headings.slice(0, 12).map((h) => `- ${h}`).join("\n")}` : "",
    `Interactive elements:\n${elements || "- (none captured)"}`,
  ]
    .filter(Boolean)
    .join("\n");
  return truncate(text, PAGE_CONTEXT_MAX);
}

// La ruta del agente que sirve de referencia: la recomendada, o si no la
// más probable de las ejecutadas. Solo los pasos del camino (sin los
// descartados al replanificar). Sin ruta ejecutada, lo dice.
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
