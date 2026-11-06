import Tooltip from "@/components/tooltip/Tooltip";
import type { Status } from "./sample";

const STYLE: Record<Status, string> = {
  recommended: "bg-success-10 text-success",
  executed: "bg-accent-10 text-accent",
  blocked: "bg-danger-10 text-danger",
  unreachable: "bg-warning-10 text-warning",
  success: "bg-success-10 text-success",
  friction: "bg-warning-10 text-warning",
  // About evidence, not outcome: a neutral outline with no fill, so it doesn't read as another result.
  unverified: "bg-transparent text-neutral-600 ring-1 ring-inset ring-neutral-400",
  // Not a result either, but the flow is alive: an outline, and none of the failure colors.
  continues: "bg-transparent text-accent ring-1 ring-inset ring-accent",
};

const MEANING: Record<Status, string> = {
  recommended: "The route with the least friction that reached the goal.",
  executed: "Ran in a real browser.",
  blocked: "The site stopped this route before it reached the goal.",
  unreachable: "No path to the goal was found, even after re-planning.",
  success: "Predicted to reach the goal.",
  friction: "Predicted to reach the goal, with friction along the way.",
  unverified: "The model says this route arrived, but no evidence confirmed it. Routes without evidence can't be recommended.",
  continues: "The flow continues outside what Spector can follow. The route isn't broken; measurement stops here.",
};

// The same status reads differently by source: a World Model BLOCKED is a prediction.
const PREDICTED_BLOCKED = "Predicted to stop before the goal.";

// The badge lives inside the row's button and can't take focus: `tooltipId` lets the row point
// aria-describedby at it and open it on focus.
export default function StatusBadge({
  status,
  tooltipId,
  predicted = false,
}: {
  status: Status;
  tooltipId?: string;
  predicted?: boolean;
}) {
  const meaning = predicted && status === "blocked" ? PREDICTED_BLOCKED : MEANING[status];
  return (
    <Tooltip content={meaning} id={tooltipId}>
      <span
        className={`inline-flex items-center rounded-sm px-8 py-4 font-heading text-label font-medium uppercase leading-rg tracking-wide ${STYLE[status]}`}
      >
        {status}
      </span>
    </Tooltip>
  );
}
