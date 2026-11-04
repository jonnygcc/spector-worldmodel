import { LoaderCircle } from "lucide-react";
import ReportSection from "./ReportSection";
import ReportTable from "./ReportTable";
import RetryButton from "@/components/loading/RetryButton";
import { toTableRoute, type WMScenario } from "./contract";

const NOTE =
  "Predicted from the first captured state, not executed. Steps and friction are estimates.";

// Requested separately by the analysis screen once the agent report is visible.
export type WorldModelState =
  | { status: "loading" }
  | { status: "ready"; scenarios: WMScenario[] }
  | { status: "error"; reason: string; retryable?: boolean; retryAfterSeconds?: number };

const TEXT = "font-body text-body font-regular leading-lg text-neutral-600";

// Fixed order Success → Friction → Blocked; sort is stable, so the engine's order holds within each.
const STATUS_RANK: Record<WMScenario["status"], number> = { success: 0, friction: 1, blocked: 2 };
const byStatus = (scenarios: WMScenario[]) =>
  [...scenarios].sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status]);

// None of these states has a Paper design, so they render as plain text in the section.
export default function WorldModelSection({
  state,
  onRetry,
}: {
  state: WorldModelState;
  onRetry?: () => void;
}) {
  const scenarios = state.status === "ready" ? state.scenarios : [];
  const meta =
    state.status === "ready"
      ? [`${scenarios.length} scenario${scenarios.length === 1 ? "" : "s"} predicted`]
      : [];

  return (
    <ReportSection
      mode="world-model"
      meta={meta}
      note={scenarios.length > 0 ? NOTE : undefined}
    >
      {state.status === "loading" && (
        <p role="status" className={`flex items-center gap-8 ${TEXT}`}>
          <LoaderCircle
            aria-hidden="true"
            className="size-16 shrink-0 animate-spin motion-reduce:animate-none"
          />
          Predicting scenarios…
        </p>
      )}

      {state.status === "error" && (
        <div role="alert" className="flex flex-col items-start gap-16">
          <div className="flex flex-col gap-4">
            <p className="font-body text-body font-medium leading-lg text-neutral-800">
              Couldn&apos;t predict scenarios for this page
            </p>
            <p className="font-body text-small font-regular leading-lg text-neutral-600">
              {state.reason}
            </p>
          </div>
          {onRetry && (
            // key: each error restarts the button's countdown.
            <RetryButton
              key={`${state.reason}-${state.retryAfterSeconds ?? 0}`}
              label="Retry"
              onRetry={onRetry}
              retryable={state.retryable}
              retryAfterSeconds={state.retryAfterSeconds}
              className="flex cursor-pointer items-center rounded-full bg-neutral-800 px-12 py-4 font-body text-small font-medium leading-rg text-neutral-100 lg:px-16 lg:py-8 lg:text-body"
            />
          )}
        </div>
      )}

      {state.status === "ready" &&
        (scenarios.length > 0 ? (
          <ReportTable routes={byStatus(scenarios).map(toTableRoute)} id="world-model" showTime={false} />
        ) : (
          <p className={TEXT}>No detours could be predicted for this analysis.</p>
        ))}
    </ReportSection>
  );
}
