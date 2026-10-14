"use client";

import { useState } from "react";

interface RouteStep {
  order: number;
  type: string;
  description: string;
  targetElement: string;
  value?: string;
}

interface RouteStepResult {
  executed: boolean;
  stateChanged: boolean;
  actualUrl: string;
  actualTitle: string;
  screenshot: string;
  realFriction: number;
  whatHappened: string;
}

interface Route {
  id: string;
  entryPoint: string;
  entryDescription: string;
  howUsersFindIt: string;
  probability: number;
  predictedSteps: RouteStep[];
  predictedFriction: number;
  frictionReason: string;
  predictedOutcome: string;
  verified: boolean;
  stepResults?: RouteStepResult[];
  realFriction?: number;
  reachedGoal?: boolean;
  verdict?: string;
}

function StepFrame({
  step,
  result,
  index,
  previousScreenshot,
}: {
  step: RouteStep;
  result?: RouteStepResult;
  index: number;
  previousScreenshot?: string;
}) {
  const blocked = result && (!result.executed || !result.stateChanged);
  const sameAsPrevious =
    result?.screenshot && previousScreenshot && result.screenshot === previousScreenshot;

  return (
    <div className="flex-shrink-0 w-[280px]">
      <div className="flex items-center gap-2 mb-2">
        <span
          className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-medium ${
            blocked ? "bg-red-400/15 text-red-400" : "bg-green-400/15 text-green-400"
          }`}
        >
          {index + 1}
        </span>
        <span className="text-xs text-gray-text truncate">
          {blocked ? "Blocked here" : result?.actualTitle || "Predicted"}
        </span>
      </div>

      <div
        className={`rounded-lg border overflow-hidden mb-2 bg-dark ${
          blocked ? "border-red-400/30" : "border-dark-border"
        }`}
      >
        {blocked || sameAsPrevious ? (
          <div className="w-full h-[170px] flex flex-col items-center justify-center text-center px-5">
            <span className="text-2xl text-red-400/50 mb-2">—</span>
            <span className="text-xs text-gray-text leading-snug">
              Screen never changed
            </span>
          </div>
        ) : result?.screenshot ? (
          <img
            src={result.screenshot}
            alt={`Step ${index + 1}`}
            className="w-full h-[170px] object-cover object-top"
          />
        ) : (
          <div className="w-full h-[170px] flex items-center justify-center text-gray-text text-xs px-4 text-center">
            Not captured — this step was only imagined
          </div>
        )}
      </div>

      <p className="text-xs text-white leading-snug mb-1">{step.description}</p>
      {result && (
        <p
          className={`text-[11px] leading-snug ${
            blocked ? "text-red-400" : "text-gray-text"
          }`}
        >
          {result.whatHappened}
        </p>
      )}
    </div>
  );
}

function RouteCard({
  route,
  isBest,
  isLikely,
}: {
  route: Route;
  isBest: boolean;
  isLikely: boolean;
}) {
  const [open, setOpen] = useState(route.verified);

  return (
    <div className="rounded-lg border border-dark-border bg-dark-card mb-4 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-5 py-4 text-left hover:bg-white/[0.02] transition-colors"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="text-sm text-white font-medium">
                via {route.entryPoint}
              </span>
              {isBest && (
                <span className="text-[10px] px-2 py-0.5 rounded bg-green-400/10 text-green-400 uppercase tracking-wide">
                  Best
                </span>
              )}
              {isLikely && (
                <span className="text-[10px] px-2 py-0.5 rounded bg-cyan/10 text-cyan uppercase tracking-wide">
                  Most taken
                </span>
              )}
              {!route.verified && (
                <span className="text-[10px] px-2 py-0.5 rounded bg-purple/10 text-purple uppercase tracking-wide">
                  Predicted
                </span>
              )}
            </div>
            <p className="text-xs text-gray-text">{route.howUsersFindIt}</p>
          </div>
          <span className="text-gray-text text-xs mt-1 flex-shrink-0">
            {open ? "−" : "+"}
          </span>
        </div>
      </button>

      {open && (
        <div className="px-5 pb-5">
          {route.verified && route.stepResults ? (
            <>
              <div className="flex gap-4 overflow-x-auto pb-3 -mx-1 px-1">
                {route.predictedSteps.map((step, i) => (
                  <StepFrame
                    key={i}
                    step={step}
                    result={route.stepResults?.[i]}
                    index={i}
                    previousScreenshot={
                      i > 0 ? route.stepResults?.[i - 1]?.screenshot : undefined
                    }
                  />
                ))}
              </div>
              {route.verdict && (
                <p className="text-xs text-gray-text mt-2">{route.verdict}</p>
              )}
            </>
          ) : (
            <div className="space-y-3">
              <div>
                <div className="text-xs uppercase tracking-wide text-gray-text mb-1">
                  Predicted steps
                </div>
                <ol className="space-y-1">
                  {route.predictedSteps.map((step, i) => (
                    <li key={i} className="text-xs text-gray-text">
                      {i + 1}. {step.description}
                    </li>
                  ))}
                </ol>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-gray-text mb-1">
                  Predicted outcome
                </div>
                <p className="text-xs text-gray-text leading-relaxed">
                  {route.predictedOutcome}
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function RouteGallery({
  routes,
  bestRouteId,
  mostLikelyRouteId,
}: {
  routes: Route[];
  bestRouteId: string | null;
  mostLikelyRouteId: string | null;
}) {
  const verified = routes.filter((r) => r.verified);
  const predicted = routes.filter((r) => !r.verified);

  return (
    <section className="mb-12">
      <h3 className="font-heading text-sm uppercase tracking-widest text-gray-text mb-1">
        Walk the routes
      </h3>
      <p className="text-xs text-gray-text mb-5">
        Screens captured while Spector walked each route in a real browser.
      </p>

      {verified.map((route) => (
        <RouteCard
          key={route.id}
          route={route}
          isBest={route.id === bestRouteId}
          isLikely={route.id === mostLikelyRouteId}
        />
      ))}

      {predicted.length > 0 && (
        <div className="mt-8">
          <h4 className="font-heading text-xs uppercase tracking-widest text-gray-text mb-3">
            Not walked
          </h4>
          <div className="opacity-70">
            {predicted.map((route) => (
              <RouteCard
                key={route.id}
                route={route}
                isBest={route.id === bestRouteId}
                isLikely={route.id === mostLikelyRouteId}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}