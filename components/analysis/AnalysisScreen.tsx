"use client";

import { useEffect, useRef, useState } from "react";
import CommandBar from "@/components/command-bar/CommandBar";
import type { BarSubmission } from "@/components/command-bar/submission";
import LoadError from "@/components/loading/LoadError";
import StageList from "@/components/loading/StageList";
import ReportHeader from "@/components/report/ReportHeader";
import ReportTable from "@/components/report/ReportTable";
import ReportSection from "@/components/report/ReportSection";
import WorldModelSection, { type WorldModelState } from "@/components/report/WorldModelSection";
import {
  agentMetaFromComparison,
  metaFromComparison,
  routesFromComparison,
} from "@/components/report/fromComparison";
import type { AnalysisStage } from "@/lib/worldmodel/goal-analysis";
import type { AnalysisEvent } from "@/lib/worldmodel/analysis-events";
import type { RouteComparison } from "@/lib/worldmodel/goal-types";
import type { WorldModelOutcome } from "@/lib/worldmodel/world-model";
import { worldModelInputOf } from "@/lib/worldmodel/world-model-input";

// The engine stops at 25 s; this covers the round trip and a server that never answers.
const WORLD_MODEL_TIMEOUT_MS = 35_000;

type Phase =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "loading"; stage: AnalysisStage }
  | { kind: "report"; result: RouteComparison }
  // Whether "Try again" can help, and when (quota).
  | {
      kind: "error";
      message: string;
      stage: AnalysisStage | null;
      retryable?: boolean;
      retryAfterSeconds?: number;
      // Changes on every error so the retry countdown restarts.
      at: number;
    };

// The World Model is requested separately after the report shows, so it never blocks the page.
// The bar stays mounted (only hidden) so Edit URL and Back keep everything the user chose.
export default function AnalysisScreen() {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [focusSignal, setFocusSignal] = useState(0);
  const [submission, setSubmission] = useState<BarSubmission | null>(null);
  const abort = useRef<AbortController | null>(null);
  const [worldModel, setWorldModel] = useState<WorldModelState>({ status: "loading" });
  const worldModelAbort = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      abort.current?.abort();
      worldModelAbort.current?.abort();
    },
    []
  );

  async function predict(result: RouteComparison) {
    worldModelAbort.current?.abort();
    const controller = new AbortController();
    worldModelAbort.current = controller;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, WORLD_MODEL_TIMEOUT_MS);

    setWorldModel({ status: "loading" });
    try {
      const response = await fetch("/api/world-model", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(worldModelInputOf(result)),
        signal: controller.signal,
      });
      const outcome = (await response.json().catch(() => null)) as WorldModelOutcome | null;
      if (outcome?.ok) setWorldModel({ status: "ready", scenarios: outcome.scenarios });
      else
        setWorldModel({
          status: "error",
          reason: outcome?.reason ?? `The prediction service failed (${response.status}).`,
          retryable: outcome?.retryable,
          retryAfterSeconds: outcome?.retryAfterSeconds,
        });
    } catch (error) {
      // Aborted by a newer request or by going home: nothing to show. A timeout does show.
      if (controller.signal.aborted && !timedOut) return;
      console.error("[WorldModel] request failed:", error);
      setWorldModel({
        status: "error",
        reason: timedOut ? "The prediction took too long." : "The prediction service couldn't be reached.",
      });
    } finally {
      clearTimeout(timer);
    }
  }

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [phase.kind]);

  async function run(next: BarSubmission) {
    setSubmission(next);
    abort.current?.abort();
    worldModelAbort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;

    setPhase({ kind: "starting" });
    let stage: AnalysisStage | null = null;

    try {
      const response = await fetch("/api/goal/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next.request),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
          retryable?: boolean;
          retryAfterSeconds?: number;
        } | null;
        setPhase({
          kind: "error",
          message: body?.error ?? `Request failed (${response.status})`,
          stage: null,
          retryable: body?.retryable,
          retryAfterSeconds: body?.retryAfterSeconds,
          at: Date.now(),
        });
        return;
      }

      setPhase({ kind: "loading", stage: "load" });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let newline: number;
        while ((newline = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (!line) continue;

          const event = JSON.parse(line) as AnalysisEvent;
          if (event.type === "stage") {
            stage = event.stage;
            setPhase({ kind: "loading", stage: event.stage });
          } else if (event.type === "result") {
            setPhase({ kind: "report", result: event.result });
            predict(event.result);
            return;
          } else {
            setPhase({
              kind: "error",
              message: event.message,
              stage: event.stage,
              retryable: event.retryable,
              retryAfterSeconds: event.retryAfterSeconds,
              at: Date.now(),
            });
            return;
          }
        }
      }

      setPhase({ kind: "error", message: "The analysis ended without a result.", stage, at: Date.now() });
    } catch (error) {
      if (controller.signal.aborted) return;
      setPhase({
        kind: "error",
        message: error instanceof Error ? error.message : "Network error",
        stage,
        at: Date.now(),
      });
    }
  }

  function backToHome() {
    abort.current?.abort();
    worldModelAbort.current?.abort();
    setPhase({ kind: "idle" });
    setFocusSignal((n) => n + 1);
  }

  const atHome = phase.kind === "idle" || phase.kind === "starting";

  return (
    <>
      <section hidden={!atHome} className="flex flex-col items-center gap-24 px-16 py-64 lg:gap-32 lg:px-24 lg:py-140">
        <h1 className="text-center font-heading text-h3 font-medium lg:text-h1 leading-rg tracking-tight text-neutral-800">
          Find the easiest path
          <br />
          to your website
        </h1>
        <CommandBar
          onSubmit={run}
          pending={phase.kind === "starting"}
          focusSignal={focusSignal}
        />
      </section>

      {phase.kind === "loading" && (
        <section aria-live="polite" aria-busy="true" className="flex flex-1 flex-col items-center justify-center px-16 py-48 lg:flex-none lg:justify-start lg:px-24 lg:py-140">
          <div className="flex w-full max-w-narrow justify-center">
            <StageList active={phase.stage} />
          </div>
        </section>
      )}

      {phase.kind === "error" && submission && (
        <section className="flex flex-col items-center px-16 py-48 lg:px-24 lg:py-140">
          <LoadError
            key={phase.at}
            url={submission.request.url}
            reason={phase.message}
            failedWhileLoading={phase.stage === "load"}
            retryable={phase.retryable}
            retryAfterSeconds={phase.retryAfterSeconds}
            onEdit={backToHome}
            onRetry={() => run(submission)}
          />
        </section>
      )}

      {phase.kind === "report" && submission && (
        <section className="flex flex-col items-start gap-24 px-16 pb-48 pt-32 lg:gap-32 lg:px-24 lg:py-64">
          <ReportHeader
            url={phase.result.url}
            goal={submission.goalLabel}
            meta={metaFromComparison(phase.result, submission.model)}
            onBack={backToHome}
          />
          {/* The World Model section always renders, with its own loading, error or scenarios state. */}
          <div className="flex w-full flex-col gap-48">
            <ReportSection mode="agent" meta={agentMetaFromComparison(phase.result)}>
              {routesFromComparison(phase.result).length > 0 ? (
                <ReportTable routes={routesFromComparison(phase.result)} firstColumn="Route" id="agent" />
              ) : (
                // No routes: the engine's verdict explains why. There's no design for this case.
                <p className="font-body text-body font-regular leading-lg text-neutral-600">
                  {phase.result.verdict}
                </p>
              )}
            </ReportSection>
            <WorldModelSection state={worldModel} onRetry={() => predict(phase.result)} />
          </div>
        </section>
      )}
    </>
  );
}
