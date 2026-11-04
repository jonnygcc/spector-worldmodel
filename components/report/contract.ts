import type { WMScenario } from "@/lib/worldmodel/report-contract";
import type { Friction, Route } from "./sample";

// The contract lives in lib/worldmodel/report-contract.ts because the engine produces it;
// re-exported here with the table adapter.
export type {
  ReportSection,
  RouteRow,
  RouteStatus,
  StepNode,
  WMKind,
  WMScenario,
} from "@/lib/worldmodel/report-contract";

// Contract friction bands: < 35 green, 35–60 blue, > 60 red.
function frictionLevel(value: number): Friction {
  if (value < 35) return "low";
  if (value <= 60) return "medium";
  return "high";
}

// Always estimated, with no Time column and no screenshots in the World Model table.
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
