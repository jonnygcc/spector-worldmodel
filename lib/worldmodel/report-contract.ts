// What an engine must fill in for a report section to render. Lives in lib/ so the World Model engine
// can produce it without depending on the UI; components/report/contract.ts re-exports it.

export interface StepNode {
  index: number;
  label: string;
  screenshot?: string; // Agent only
}

export type RouteStatus = "recommended" | "executed" | "blocked" | "success" | "friction";

export interface RouteRow {
  user: string; // agent: route/persona | world model: scenario name
  subtitle?: string; // world model: kind ("Alternative route", etc.)
  time: string;
  probability: number; // 0–100
  steps: number;
  friction: number; // 0–100
  status: RouteStatus;
  estimated?: boolean; // world model: "~" on time/steps
  // Reached steps in index order: blue in the timeline up to here, then neutral-200. Without it all
  // are reached, except in BLOCKED, which stops at the first failed step.
  reachedSteps?: number;
  stepNodes: StepNode[];
}

// A prediction: no Time and no screenshots (always rendered as estimated).
export type WMKind = "Alternative route" | "User error" | "UI confusion" | "Flow block";

export interface WMScenario {
  user: string;
  subtitle: WMKind;
  probability: number; // 0-100
  steps: number;
  friction: number; // 0-100
  status: "success" | "friction" | "blocked";
  // = steps for success/friction; < steps for blocked.
  reachedSteps: number;
  // One sentence for the designer, naming the concrete element.
  recommendation: string;
  stepNodes: StepNode[]; // no screenshot
}

export interface ReportSection {
  mode: "agent" | "world-model";
  meta: string;
  rows: RouteRow[];
}
