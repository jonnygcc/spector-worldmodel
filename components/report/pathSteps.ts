import type { Route, Step } from "./sample";

// La tira solo trae el camino (fromComparison deja fuera los pasos
// descartados al replanificar): la columna Steps y la numeración cuentan
// todos sus pasos.

export const pathLength = (steps: Step[]) => steps.length;

// Número del paso dentro del camino ("01", "02"…).
export const pathNumber = (index: number) => String(index + 1).padStart(2, "0");

// Marca los pasos no alcanzados, para que el timeline cambie de azul a
// neutral-600 justo donde la ruta se detuvo. Una ruta completada
// (RECOMMENDED, EXECUTED, SUCCESS) llega entera; una BLOCKED o
// UNREACHABLE, hasta `reachedSteps` o, sin él, hasta el primer paso que
// falló (el que falló ya no cuenta como alcanzado).
export function withReach(route: Route): Step[] {
  const stopped = route.status === "blocked" || route.status === "unreachable";
  const firstFailed = route.steps.findIndex((step) => step.failed);
  const cutoff =
    route.reachedSteps ??
    (stopped && firstFailed !== -1 ? firstFailed : route.steps.length);
  return route.steps.map((step, i) => (i < cutoff ? step : { ...step, unreached: true }));
}
