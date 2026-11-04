import type { Route, Step } from "./sample";

// The strip only carries the path (re-plan discards are dropped), so Steps and numbering count all of it.

export const pathLength = (steps: Step[]) => steps.length;

// Step number within the path ("01", "02"…).
export const pathNumber = (index: number) => String(index + 1).padStart(2, "0");

// Marks unreached steps so the timeline turns gray exactly where the route stopped; the failed
// step itself no longer counts as reached.
export function withReach(route: Route): Step[] {
  const stopped = route.status === "blocked" || route.status === "unreachable";
  const firstFailed = route.steps.findIndex((step) => step.failed);
  const cutoff =
    route.reachedSteps ??
    (stopped && firstFailed !== -1 ? firstFailed : route.steps.length);
  return route.steps.map((step, i) => (i < cutoff ? step : { ...step, unreached: true }));
}
