"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import LoadingState from "./LoadingState";
import RouteGallery from "./RouteGallery";

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

interface GoalData {
  id: string;
  label: string;
  description: string;
}

interface PersonaData {
  id: string;
  label: string;
  description: string;
  traits: string[];
  patience: string;
  techSavvy: string;
}

export interface RouteComparison {
  url: string;
  goal: GoalData;
  persona: PersonaData;
  personaMode: string;
  routes: Route[];
  bestRouteId: string | null;
  mostLikelyRouteId: string | null;
  verdict: string;
  recommendation: string;
}

function frictionLabel(value: number | undefined): { text: string; color: string } {
  if (value === undefined) return { text: "Not tested", color: "text-gray-text" };
  if (value >= 0.7) return { text: "High", color: "text-red-400" };
  if (value >= 0.4) return { text: "Medium", color: "text-yellow-400" };
  return { text: "Low", color: "text-green-400" };
}

export default function GoalReport({
  onLoaded,
}: {
  onLoaded?: (data: RouteComparison) => void;
}) {
  const searchParams = useSearchParams();

  const url = searchParams.get("url");
  const goal = searchParams.get("goal");
  const personaMode = searchParams.get("personaMode") || "automatic";
  const persona = searchParams.get("persona");

  const [report, setReport] = useState<RouteComparison | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!url || !goal) {
      setError("Missing URL or goal");
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function analyze() {
      try {
        const response = await fetch("/api/goal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url,
            goalId: goal,
            personaMode,
            customPersona: persona || undefined,
          }),
        });

        const data = await response.json();
        if (cancelled) return;

        if (!response.ok) {
          setError(data.error || "Analysis failed");
          return;
        }

        setReport(data);
        onLoaded?.(data);
      } catch {
        if (!cancelled) setError("Could not connect to the server");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    analyze();
    return () => {
      cancelled = true;
    };
  }, [url, goal, personaMode, persona, onLoaded]);

  if (loading) return <LoadingState />;

  if (error || !report) {
    return (
      <div className="text-center py-20">
        <p className="text-red-400 mb-2">{error || "No report available"}</p>
        <a href="/" className="text-cyan text-sm hover:underline">
          Try again
        </a>
      </div>
    );
  }

  const bestRoute = report.routes.find((r) => r.id === report.bestRouteId);
  const likelyRoute = report.routes.find((r) => r.id === report.mostLikelyRouteId);
  const mismatch =
    bestRoute && likelyRoute && bestRoute.id !== likelyRoute.id;

  return (
    <div className="max-w-3xl mx-auto">
      <a
        href="/"
        className="text-sm text-gray-text hover:text-cyan transition-colors inline-block mb-8"
      >
        ← Run another analysis
      </a>

      {/* HEADER */}
      <section className="mb-12">
        <div className="text-xs text-gray-text uppercase tracking-widest mb-2">
          {report.url}
        </div>
        <h2 className="font-heading text-3xl font-bold mb-2">
          {report.goal.label}
        </h2>
        <p className="text-sm text-gray-text">
          Simulated as: <span className="text-cyan">{report.persona.label}</span>
          {report.personaMode === "personal" && " (your persona)"}
        </p>
      </section>

      {/* VERDICT */}
      <section className="mb-12">
        <p className="text-xl text-white leading-relaxed mb-6">{report.verdict}</p>

        <div className="rounded-lg border border-cyan/30 bg-cyan/5 p-5">
          <div className="text-xs uppercase tracking-widest text-cyan mb-2">
            Recommendation
          </div>
          <p className="text-white text-sm leading-relaxed">
            {report.recommendation}
          </p>
        </div>

        {mismatch && (
          <div className="mt-4 rounded-lg border border-yellow-400/30 bg-yellow-400/5 p-5">
            <div className="text-xs uppercase tracking-widest text-yellow-400 mb-2">
              Path mismatch
            </div>
            <p className="text-white text-sm leading-relaxed">
              Most users take <span className="text-cyan">{likelyRoute?.entryPoint}</span>,
              but the smoothest path is <span className="text-cyan">{bestRoute?.entryPoint}</span>.
            </p>
          </div>
        )}
      </section>

      {/* COMPARISON TABLE */}
      <section className="mb-12">
        <h3 className="font-heading text-sm uppercase tracking-widest text-gray-text mb-5">
          Routes compared
        </h3>

        <div className="rounded-lg border border-dark-border bg-dark-card overflow-hidden">
          <div className="grid grid-cols-[2fr_auto_auto_auto] gap-4 px-5 py-3 border-b border-dark-border text-xs uppercase tracking-wide text-gray-text">
            <div>Entry point</div>
            <div className="text-right">Users</div>
            <div className="text-right">Steps</div>
            <div className="text-right">Friction</div>
          </div>

          {report.routes.map((route) => {
            const isBest = route.id === report.bestRouteId;
            const isLikely = route.id === report.mostLikelyRouteId;
            const friction = frictionLabel(
              route.verified ? route.realFriction : undefined
            );

            return (
              <div
                key={route.id}
                className="grid grid-cols-[2fr_auto_auto_auto] gap-4 px-5 py-4 border-b border-dark-border last:border-0 items-center"
              >
                <div>
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-sm text-white font-medium">
                      {route.entryPoint}
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
                  </div>
                  <div className="text-xs text-gray-text">
                    {route.verified ? route.verdict : "Predicted only, not tested"}
                  </div>
                </div>

                <div className="text-right text-sm text-white">
                  {Math.round(route.probability * 100)}%
                </div>

                <div className="text-right text-sm text-white">
                  {route.predictedSteps.length}
                </div>

                <div className={`text-right text-sm ${friction.color}`}>
                  {friction.text}
                </div>
              </div>
            );
          })}
        </div>

        <p className="text-xs text-gray-text mt-3">
          Spector verified the {report.routes.filter((r) => r.verified).length} most
          likely routes in a real browser. The rest are predictions only.
        </p>
      </section>

      <RouteGallery
        routes={report.routes}
        bestRouteId={report.bestRouteId}
        mostLikelyRouteId={report.mostLikelyRouteId}
      />
    </div>
  );
}