import { LoaderCircle } from "lucide-react";
import ReportSection from "./ReportSection";
import ReportTable from "./ReportTable";
import RetryButton from "@/components/loading/RetryButton";
import { toTableRoute, type WMScenario } from "./contract";

const NOTE =
  "Predicted from the first captured state, not executed. Steps and friction are estimates.";

// Estado de la predicción. La pide la pantalla del análisis aparte, cuando
// el reporte del agente ya está a la vista.
export type WorldModelState =
  | { status: "loading" }
  | { status: "ready"; scenarios: WMScenario[] }
  | { status: "error"; reason: string; retryable?: boolean; retryAfterSeconds?: number };

const TEXT = "font-body text-body font-regular leading-lg text-neutral-600";

// Orden fijo de las filas: Success → Friction → Blocked. Dentro de cada
// status se mantiene el orden del motor (sort es estable).
const STATUS_RANK: Record<WMScenario["status"], number> = { success: 0, friction: 1, blocked: 2 };
const byStatus = (scenarios: WMScenario[]) =>
  [...scenarios].sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status]);

// Sección World Model del reporte. Se dibuja siempre, debajo del Agent,
// con la misma tabla menos la columna Time. Ninguno de estos estados tiene
// diseño en Paper; van como texto en la sección, sin tocar el resto:
// - loading: spinner y "Predicting scenarios…" (el spinner no gira con
//   reduced motion).
// - error: qué pasó, la razón corta del motor y Retry (el mismo botón
//   oscuro del error de carga).
// - ready sin escenarios (el motor los descartó todos): una línea gris.
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
            // key: cada error reinicia la cuenta atrás del botón.
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
