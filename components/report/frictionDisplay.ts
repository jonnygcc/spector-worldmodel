import type { Friction, Route } from "./sample";

export interface FrictionDisplay {
  value: number;
  level: Friction;
  text: string;
  partial: boolean;
}

// Partial reads "0+" because the unmeasured part of the flow can only add friction.
export function frictionDisplay({ friction, status }: Pick<Route, "friction" | "status">): FrictionDisplay {
  const { value, level } = friction;
  const partial = status === "continues";
  return { value, level, partial, text: partial ? `${value}+` : String(value) };
}
