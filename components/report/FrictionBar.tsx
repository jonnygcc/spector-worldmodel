import type { FrictionDisplay } from "./frictionDisplay";
import type { Friction } from "./sample";

const FILL: Record<Friction, string> = {
  low: "bg-success",
  medium: "bg-accent",
  high: "bg-danger",
};

// Hatching is the part of the flow nobody measured: with 0 there's no fill to dim, so it goes on the track.
const PARTIAL_TRACK =
  "[background-image:repeating-linear-gradient(135deg,var(--color-neutral-400)_0_2px,transparent_2px_4px)]";

// NO TOKEN: the 100px track. Same in Agent and World Model: "~" and the footnote already
// mark a scenario as estimated.
export default function FrictionBar({ display }: { display: FrictionDisplay }) {
  const { value, level, text, partial } = display;
  return (
    <span className="flex items-center gap-8">
      <span className={`flex h-4 w-[100px] shrink-0 rounded-sm bg-neutral-200 ${partial ? PARTIAL_TRACK : ""}`}>
        <span className={`h-4 rounded-sm ${FILL[level]} ${partial ? "opacity-50" : ""}`} style={{ width: `${value}%` }} />
      </span>
      <span className="font-heading text-body leading-sm tabular-nums text-neutral-800">{text}</span>
    </span>
  );
}
