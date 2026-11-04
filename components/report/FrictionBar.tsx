import type { Friction } from "./sample";

const FILL: Record<Friction, string> = {
  low: "bg-success",
  medium: "bg-accent",
  high: "bg-danger",
};

// NO TOKEN: the 100px track. Same in Agent and World Model: "~" and the footnote already
// mark a scenario as estimated.
export default function FrictionBar({ value, level }: { value: number; level: Friction }) {
  return (
    <span className="flex items-center gap-8">
      <span className="flex h-4 w-[100px] shrink-0 rounded-sm bg-neutral-200">
        <span className={`h-4 rounded-sm ${FILL[level]}`} style={{ width: `${value}%` }} />
      </span>
      <span className="font-heading text-body leading-sm tabular-nums text-neutral-800">
        {value}
      </span>
    </span>
  );
}
