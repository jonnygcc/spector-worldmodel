import type { Friction, Route } from "./sample";

export type FrictionKind = "measured" | "estimated" | "partial";

export interface FrictionDisplay {
  kind: FrictionKind;
  level: Friction;
  text: string;
  // Where the bar's fill sits on the track, in percent.
  start: number;
  width: number;
  tip?: string;
}

// Half the worst spread seen for one scenario across runs of the same analysis (45 points, at temperature 0).
export const ESTIMATE_MARGIN = 25;

export const ESTIMATED_TIP = "Predicted, not measured, and it shifts between runs. Read it as a rough range.";
export const PARTIAL_TIP = "Measured up to the handoff only. Not comparable with routes measured end to end.";

// Partial reads "0+" because the unmeasured part of the flow can only add friction.
export function frictionDisplay({ friction, estimated, status }: Pick<Route, "friction" | "estimated" | "status">): FrictionDisplay {
  const { value, level } = friction;
  if (estimated) {
    const center = Math.round(value / 5) * 5;
    const low = Math.max(0, center - ESTIMATE_MARGIN);
    const high = Math.min(100, center + ESTIMATE_MARGIN);
    return { kind: "estimated", level, text: `${low}–${high}`, start: low, width: high - low, tip: ESTIMATED_TIP };
  }
  if (status === "continues") {
    return { kind: "partial", level, text: `${value}+`, start: 0, width: value, tip: PARTIAL_TIP };
  }
  return { kind: "measured", level, text: String(value), start: 0, width: value };
}
