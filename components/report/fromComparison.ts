import type { RouteComparison, Route as EngineRoute } from "@/lib/worldmodel/goal-types";
import type { MetaItem } from "./MetaList";
import type { Friction, Route, Status, Step } from "./sample";

// RouteComparison del motor → filas del Reporte.
//
// Correspondencias:
// - Filas: solo las rutas que se ejecutaron en un navegador. Las que el
//   motor predijo y no intentó no se listan; cuántas eran sale en la meta
//   de la cabecera ("2 OF 4 ROUTES EXECUTED").
// - Primera columna: el nombre de la ruta en inglés (route.name); si el
//   modelo no lo dio, la etiqueta literal del punto de entrada.
// - Probability: route.probability (0–1) en porcentaje. Si la ruta se
//   replanificó, describía el plan inicial y no el camino recorrido: va
//   marcada como estimada con "~".
// - Steps: el camino recorrido en el navegador, con su captura. Los pasos
//   que el motor descartó al replanificar no se muestran: son telemetría
//   del motor (quedan en el log del servidor y en stepResults). Solo en
//   una ruta que no llegó se marca el paso que falló o divergió; en una que
//   llegó (EXECUTED, RECOMMENDED) ningún paso va en rojo, aunque alguno no
//   coincidiera del todo con lo esperado.
// - Friction: realFriction (0–1) en 0–100. Nivel: < 34 bajo, < 67 medio,
//   resto alto.
// - Status: RECOMMENDED si es bestRouteId; si no, según cómo terminó:
//   EXECUTED (llegó), BLOCKED (el sitio la detuvo) o UNREACHABLE (no
//   encontró camino tras replanificar).
// - Time: el motor no lo mide → "—".
// - reachedSteps: en una ruta bloqueada, todos menos el último paso.

function frictionLevel(value: number): Friction {
  if (value < 34) return "low";
  if (value < 67) return "medium";
  return "high";
}

function statusOf(route: EngineRoute, bestRouteId: string | null): Status {
  if (route.id === bestRouteId) return "recommended";
  if (route.outcome === "blocked") return "blocked";
  if (route.outcome === "unreachable") return "unreachable";
  return route.reachedGoal ? "executed" : "blocked";
}

function stepsOf(route: EngineRoute): Step[] {
  const reached = route.reachedGoal === true || route.outcome === "reached";
  return (route.stepResults ?? [])
    .filter((result) => !result.discarded)
    .map((result) => ({
    label: result.step?.description || result.whatHappened,
    failed: !reached && (!result.executed || !result.stateChanged || result.check === "diverged"),
    screenshot: result.screenshot,
  }));
}

const executedRoutes = (result: RouteComparison) =>
  result.routes.filter((route) => route.verified);

export function routesFromComparison(result: RouteComparison): Route[] {
  return executedRoutes(result).map((route) => {
    const friction = Math.round((route.realFriction ?? route.predictedFriction) * 100);
    const probability = `${Math.round(route.probability * 100)}%`;
    const steps = stepsOf(route);
    return {
      user: route.name || route.entryPoint,
      time: "—",
      probability: route.probabilityEstimated ? `~${probability}` : probability,
      friction: { value: friction, level: frictionLevel(friction) },
      status: statusOf(route, result.bestRouteId),
      steps,
      // Bloqueada: el último paso es el que llevó al bloqueo (login, pago,
      // anti-bots); desde ahí, el timeline pasa a neutral-600. En las demás
      // decide withReach (pathSteps.ts).
      reachedSteps: route.outcome === "blocked" ? steps.length - 1 : undefined,
    };
  });
}

export function metaFromComparison(result: RouteComparison, model: string): MetaItem[] {
  const date = new Date().toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return [date, { label: "Model", value: model }];
}

// Meta de la sección Agent. El motor analiza con un solo perfil: "1 profile".
export function agentMetaFromComparison(result: RouteComparison): string[] {
  const executed = executedRoutes(result).length;
  const found = result.routesFound ?? result.routes.length;
  return [`${executed} of ${found} routes executed`, "1 profile"];
}
