"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import FrictionBar from "./FrictionBar";
import StatusBadge from "./StatusBadge";
import { pathLength, withReach } from "./pathSteps";
import StepStrip from "./StepStrip";
import type { Route } from "./sample";

// NO TOKEN: column widths from the frame. Paper's STATUS header was 180 because it included
// the chevron gap; here the chevron is its own 24px column.
const COL = {
  time: "w-[100px]",
  probability: "w-[100px]",
  steps: "w-96",
  friction: "w-[200px]", // fits "FRICTION (LOWER IS BETTER)" on one line
  status: "w-[140px]",
  chevron: "w-24",
};

const HEAD =
  "font-heading text-label font-medium uppercase leading-rg tracking-wide text-neutral-600";

// No header tooltips: FRICTION's label already says enough; only status badges have one.
const FRICTION_LABEL = "Friction (lower is better)";

const NUMBER =
  "font-heading text-body leading-sm tracking-wide tabular-nums text-neutral-800";

// Columns that only exist on desktop (lg, from 1024px).
const DESKTOP = "hidden lg:block";

// Mobile metric: label above the value (Phone/Report frame).
function Metric({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-8">
      <span className={HEAD}>{label}</span>
      {children}
    </div>
  );
}

// One open row at a time; below lg it becomes a list with the metrics inside the open row.
// `firstColumn`: the design says USER, but the engine returns one row per route, hence "Route".
export default function ReportTable({
  routes,
  firstColumn = "User",
  id = "route",
  showTime = true,
}: {
  routes: Route[];
  firstColumn?: string;
  id?: string;
  showTime?: boolean;
}) {
  const [open, setOpen] = useState<number | null>(0);

  return (
    // overflow-hidden keeps the timeline inside the card's radius; tooltips use a portal so they
    // aren't clipped. min-w-0 stops wide content from widening the card.
    <div className="flex w-full min-w-0 flex-col overflow-hidden rounded-md border border-neutral-300 bg-neutral-100 shadow-bar">
      <div className="flex items-center gap-16 rounded-t-md border-b border-neutral-300 bg-surface px-16 py-12">
        <span className={`flex-1 ${HEAD}`}>{firstColumn}</span>
        {showTime && <span className={`shrink-0 ${COL.time} ${HEAD} ${DESKTOP}`}>Time</span>}
        <span className={`shrink-0 ${COL.probability} ${HEAD} ${DESKTOP}`}>Probability</span>
        <span className={`shrink-0 ${COL.steps} ${HEAD} ${DESKTOP}`}>Steps</span>
        <span className={`shrink-0 ${COL.friction} ${HEAD} ${DESKTOP}`}>{FRICTION_LABEL}</span>
        <span className={`shrink-0 ${COL.status} ${HEAD} ${DESKTOP}`}>Status</span>
        <span aria-hidden="true" className={`shrink-0 ${COL.chevron} ${DESKTOP}`} />
      </div>

      <ul>
        {routes.map((route, i) => {
          const isOpen = open === i;
          const panelId = `${id}-${i}-steps`;
          const statusTipId = `${id}-${i}-status-tip`;
          const count = route.stepCount ?? pathLength(route.steps);
          const steps = route.estimated ? `~${count}` : count;

          return (
            <li
              key={i}
              className="border-b border-neutral-300 py-16 last:border-b-0 lg:py-24 lg:pl-16"
            >
              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={panelId}
                aria-describedby={route.status ? statusTipId : undefined}
                onClick={() => setOpen(isOpen ? null : i)}
                // data-tip-anchor: focusing the row with the keyboard opens the status badge tooltip.
                data-tip-anchor=""
                className="flex w-full cursor-pointer items-center gap-16 px-16 text-left lg:pl-0"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-4 break-words">
                  <span className="font-body text-body font-medium leading-lg text-neutral-800">
                    {route.user}
                  </span>
                  {route.subtitle && (
                    <span className="font-body text-small leading-sm text-neutral-600">
                      {route.subtitle}
                    </span>
                  )}
                </span>
                {showTime && (
                  <span className={`shrink-0 ${COL.time} ${NUMBER} ${DESKTOP}`}>{route.time}</span>
                )}
                <span className={`shrink-0 ${COL.probability} ${NUMBER} ${DESKTOP}`}>
                  {route.probability}
                </span>
                <span className={`shrink-0 ${COL.steps} ${NUMBER} ${DESKTOP}`}>{steps}</span>
                <span className={`shrink-0 ${COL.friction} ${DESKTOP}`}>
                  <FrictionBar value={route.friction.value} level={route.friction.level} />
                </span>
                <span className={`shrink-0 ${COL.status} ${DESKTOP}`}>
                  {route.status ? (
                    <StatusBadge
                      status={route.status}
                      tooltipId={statusTipId}
                      predicted={route.estimated}
                    />
                  ) : (
                    <span className={NUMBER}>—</span>
                  )}
                </span>
                <ChevronDown
                  aria-hidden="true"
                  className={`size-24 shrink-0 text-neutral-800 transition-transform duration-150 ${
                    isOpen ? "rotate-180" : ""
                  }`}
                />
              </button>

              {/* Height animates 0fr → 1fr; the open row's extra spacing lives inside so it animates too. */}
              <div
                id={panelId}
                // minmax(0, 1fr): with an auto column the timeline (wider than the card) pushed it past the right edge.
                className={`grid grid-cols-[minmax(0,1fr)] transition-[grid-template-rows] duration-150 ${
                  isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                }`}
              >
                <div className="min-w-0 overflow-hidden" inert={!isOpen}>
                  <div className="flex min-w-0 flex-col gap-24 pb-16 pt-24 lg:pb-8">
                    <div className="flex flex-col gap-24 px-16 lg:hidden">
                      <div className="flex flex-wrap gap-24">
                        {showTime && (
                          <Metric label="Time">
                            <span className={NUMBER}>{route.time}</span>
                          </Metric>
                        )}
                        <Metric label="Probability">
                          <span className={NUMBER}>{route.probability}</span>
                        </Metric>
                        <Metric label="Steps">
                          <span className={NUMBER}>{steps}</span>
                        </Metric>
                      </div>
                      <div className="flex flex-wrap gap-24">
                        <Metric label={FRICTION_LABEL}>
                          <FrictionBar value={route.friction.value} level={route.friction.level} />
                        </Metric>
                        <Metric label="Status">
                          {route.status ? (
                            <StatusBadge status={route.status} predicted={route.estimated} />
                          ) : (
                            <span className={NUMBER}>—</span>
                          )}
                        </Metric>
                      </div>
                    </div>

                    <StepStrip steps={withReach(route)} simulated={route.estimated} />

                    {/* World Model recommendation card, styled like the frame's note box. */}
                    {route.recommendation && (
                      <div className="px-16 lg:pl-0">
                        <div className="flex min-w-0 flex-col gap-8 break-words rounded-md bg-success-10 px-24 py-16">
                          <h3 className="font-heading text-h5 font-medium leading-rg text-neutral-800">
                            Recommendation
                          </h3>
                          <p className="font-body text-body font-regular leading-lg text-neutral-700">
                            {route.recommendation}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
