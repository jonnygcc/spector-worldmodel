import Tooltip from "@/components/tooltip/Tooltip";
import type { FrictionDisplay, FrictionKind } from "./frictionDisplay";
import type { Friction } from "./sample";

const FILL: Record<Friction, string> = {
  low: "bg-success",
  medium: "bg-accent",
  high: "bg-danger",
};

// Measured is solid; a faded band is a guess; hatching is the part of the flow nobody measured.
const TRACK: Record<FrictionKind, string> = {
  measured: "bg-neutral-200",
  estimated: "bg-neutral-200",
  partial:
    "bg-neutral-200 [background-image:repeating-linear-gradient(135deg,var(--color-neutral-400)_0_2px,transparent_2px_4px)]",
};

// NO TOKEN: the 100px track. Below: on keyboard focus the row opens this tooltip and the status one together.
export default function FrictionBar({ display, tooltipId }: { display: FrictionDisplay; tooltipId?: string }) {
  const { kind, level, text, start, width, tip } = display;
  const bar = (
    <span className="flex items-center gap-8">
      <span className={`flex h-4 w-[100px] shrink-0 rounded-sm ${TRACK[kind]}`}>
        <span
          className={`h-4 rounded-sm ${FILL[level]} ${kind === "measured" ? "" : "opacity-50"}`}
          style={{ marginLeft: `${start}%`, width: `${width}%` }}
        />
      </span>
      <span className="font-heading text-body leading-sm tabular-nums text-neutral-800">{text}</span>
    </span>
  );
  return tip ? (
    <Tooltip content={tip} id={tooltipId} below className="flex">
      {bar}
    </Tooltip>
  ) : (
    bar
  );
}
