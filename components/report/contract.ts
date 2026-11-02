import type { WMScenario } from "@/lib/worldmodel/report-contract";
import type { Friction, Route } from "./sample";

// El contrato (RouteRow, StepNode…) vive en lib/worldmodel/report-contract.ts,
// porque lo produce el motor; aquí se reexporta con el adaptador a la tabla.
export type {
  ReportSection,
  RouteRow,
  RouteStatus,
  StepNode,
  WMKind,
  WMScenario,
} from "@/lib/worldmodel/report-contract";

// Bandas de fricción del contrato: < 35 verde, 35–60 azul, > 60 rojo.
function frictionLevel(value: number): Friction {
  if (value < 35) return "low";
  if (value <= 60) return "medium";
  return "high";
}

// Escenario del World Model → fila de la tabla compartida (ReportTable).
// Siempre estimado; sin Time (la tabla del World Model no tiene esa
// columna) y sin capturas.
export function toTableRoute(scenario: WMScenario): Route {
  return {
    user: scenario.user,
    subtitle: scenario.subtitle,
    time: "—",
    probability: `${scenario.probability}%`,
    friction: { value: scenario.friction, level: frictionLevel(scenario.friction) },
    status: scenario.status,
    estimated: true,
    stepCount: scenario.steps,
    reachedSteps: scenario.reachedSteps,
    recommendation: scenario.recommendation,
    steps: [...scenario.stepNodes]
      .sort((a, b) => a.index - b.index)
      .map((node) => ({ label: node.label })),
  };
}
