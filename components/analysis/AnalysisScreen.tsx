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

// Tiempo máximo de la petición del World Model desde el navegador. El
// motor corta a los 25s; esto cubre el viaje y un servidor que no responde.
const WORLD_MODEL_TIMEOUT_MS = 35_000;

type Phase =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "loading"; stage: AnalysisStage }
  | { kind: "report"; result: RouteComparison }
  // retryable / retryAfterSeconds: si "Try again" sirve y cuándo (cuota).
  | {
      kind: "error";
      message: string;
      stage: AnalysisStage | null;
      retryable?: boolean;
      retryAfterSeconds?: number;
      // Cambia en cada error: reinicia la cuenta atrás del botón.
      at: number;
    };

// Pantalla única del análisis. La Home es el estado inicial; al enviar
// pasa a Loading con la etapa real que reporta el motor, y de ahí a
// Reporte o Error.
//
// El reporte se muestra en cuanto el agente termina. El World Model se
// pide después, aparte (/api/world-model): su sección tiene su propio
// loading, y si falla, su propio error con Retry; nunca bloquea la página.
//
// La barra se queda montada (solo se oculta) para que "Edit URL" y "Back
// to home" vuelvan con todo lo que se había elegido: URL, objetivo, modo,
// perfiles y modelo.
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
      // Abortada por una petición nueva o por volver a la Home: no hay nada
      // que mostrar. Por el tiempo máximo, sí.
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

      // Rechazo antes de empezar (validación, origen, límite de uso): JSON
      // con { error } y, si aplica, retryable / retryAfterSeconds.
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
          {/* Agent con los datos reales del motor; World Model debajo,
              siempre, con su propio estado (cargando, error o escenarios). */}
          <div className="flex w-full flex-col gap-48">
            <ReportSection mode="agent" meta={agentMetaFromComparison(phase.result)}>
              {routesFromComparison(phase.result).length > 0 ? (
                <ReportTable routes={routesFromComparison(phase.result)} firstColumn="Route" id="agent" />
              ) : (
                // Sin rutas: el motor explica por qué en su veredicto. No hay
                // diseño para este caso.
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
