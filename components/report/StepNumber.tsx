import { pathNumber } from "./pathSteps";
import type { Step } from "./sample";

// Unreached wins over danger: the failed step of a blocked route is exactly where it stopped.
export default function StepNumber({ steps, index }: { steps: Step[]; index: number }) {
  const step = steps[index];
  const tone = step.unreached
    ? "bg-neutral-200 text-neutral-600"
    : `text-neutral-100 ${step.failed ? "bg-danger" : "bg-accent"}`;
  return (
    <span
      className={`relative rounded-sm p-4 font-body text-label font-semibold leading-sm tabular-nums ${tone}`}
    >
      {pathNumber(index)}
    </span>
  );
}
