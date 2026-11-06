import type { RouteComparison, Route as EngineRoute } from "@/lib/worldmodel/goal-types";
import type { MetaItem } from "./MetaList";
import type { Friction, Route, Status, Step } from "./sample";

// Only browser-executed routes become rows. Steps discarded on re-plan are engine telemetry and
// stay hidden; only a route that stopped marks its failed step in red, and one that continues elsewhere didn't.

function frictionLevel(value: number): Friction {
  if (value < 34) return "low";
  if (value < 67) return "medium";
  return "high";
}

// Re-checked here so a route that arrived without evidence is UNVERIFIED even if the engine picked it.
export function statusOf(route: EngineRoute, bestRouteId: string | null): Status {
  const reached = route.outcome === "reached" || (route.outcome === undefined && route.reachedGoal);
  if (reached && route.goalVerified !== true) return "unverified";
  if (route.id === bestRouteId) return "recommended";
  if (route.outcome === "continues") return "continues";
  if (route.outcome === "blocked") return "blocked";
  if (route.outcome === "unreachable") return "unreachable";
  return route.reachedGoal ? "executed" : "blocked";
}

function stepsOf(route: EngineRoute): Step[] {
  const stopped = route.reachedGoal !== true && route.outcome !== "reached" && route.outcome !== "continues";
  return (route.stepResults ?? [])
    .filter((result) => !result.discarded)
    .map((result) => ({
    label: result.step?.description || result.whatHappened,
    failed: stopped && (!result.executed || !result.stateChanged || result.check === "diverged"),
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
      subtitle: route.continuation,
      time: "—",
      probability: route.probabilityEstimated ? `~${probability}` : probability,
      friction: { value: friction, level: frictionLevel(friction) },
      status: statusOf(route, result.bestRouteId),
      steps,
      // Blocked: the last step led to the block (login, payment, bot check); other routes use withReach.
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

// The engine analyzes with a single profile, hence "1 profile".
export function agentMetaFromComparison(result: RouteComparison): string[] {
  const executed = executedRoutes(result).length;
  const found = result.routesFound ?? result.routes.length;
  return [`${executed} of ${found} routes executed`, "1 profile"];
}
