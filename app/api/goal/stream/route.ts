import { NextRequest, NextResponse } from "next/server";
import { runGoalAnalysis, type AnalysisStage } from "@/lib/worldmodel/goal-analysis";
import { goalFromText } from "@/lib/worldmodel/goal-types";
import {
  MAX_ANALYSIS_BODY,
  validateAnalysisRequest,
  type AnalysisEvent,
} from "@/lib/worldmodel/analysis-events";
import { assertAllowedUrl, URL_NOT_ALLOWED } from "@/lib/security/url-guard";
import { checkApiRequest, readBody } from "@/lib/security/request-guard";
import { ANALYSIS_LIMIT, createLimiter } from "@/lib/security/usage-limit";
import { describeFailure, type Failure } from "@/lib/llm/model-errors";

export const maxDuration = 300;

// Un análisis a la vez, y un tope por ventana de tiempo: protegen la cuota
// de Gemini del usuario (lib/security/usage-limit.ts).
const limiter = createLimiter(ANALYSIS_LIMIT);

// Rechazo antes de empezar: JSON con { error } y, si aplica, cuándo
// reintentar (también como Retry-After).
function reject(status: number, error: string, failure?: Omit<Failure, "message">) {
  return NextResponse.json(
    { error, ...failure },
    {
      status,
      headers: failure?.retryAfterSeconds ? { "Retry-After": String(failure.retryAfterSeconds) } : undefined,
    }
  );
}

// Análisis con progreso: responde con un stream NDJSON, un evento "stage"
// cada vez que el motor entra en una etapa, y al final un "result" con el
// RouteComparison completo o un "error" con el motivo real (Failure) y la
// etapa en la que falló.
//
// Antes de gastar nada (paso 9): origen y tipo de contenido, tamaño,
// esquema estricto, URL permitida y límite de uso. Si el cliente se
// desconecta, el análisis se aborta.
export async function POST(request: NextRequest) {
  const guard = checkApiRequest(request.headers);
  if (!guard.ok) return reject(guard.status, guard.error);

  const raw = await readBody(request, MAX_ANALYSIS_BODY);
  if (!raw.ok) return reject(raw.status, raw.error);

  let body: unknown;
  try {
    body = JSON.parse(raw.text);
  } catch {
    return reject(400, "Invalid request body");
  }

  const validation = validateAnalysisRequest(body);
  if (!validation.ok) return reject(400, validation.error);
  const { url, goal, personaMode, customPersona } = validation.request;

  // Esquema, host, puerto y la IP resuelta, antes de abrir el navegador.
  // El proxy del navegador vuelve a validar cada conexión (redirecciones
  // incluidas).
  try {
    await assertAllowedUrl(url);
  } catch {
    return reject(400, URL_NOT_ALLOWED, { kind: "not-allowed", retryable: false });
  }

  const slot = limiter.acquire();
  if (!slot.ok) {
    return reject(429, slot.message, { kind: "busy", retryable: true, retryAfterSeconds: slot.retryAfterSeconds });
  }

  // El cliente cerró la pestaña o abortó el fetch: se cancela el análisis
  // (navegadores cerrados, llamadas al modelo cortadas).
  const cancel = new AbortController();
  request.signal.addEventListener("abort", () => cancel.abort(), { once: true });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (event: AnalysisEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          open = false;
        }
      };

      let current: AnalysisStage | null = null;
      try {
        const result = await runGoalAnalysis(
          url,
          goalFromText(goal),
          personaMode,
          customPersona,
          (stage) => {
            current = stage;
            send({ type: "stage", stage });
          },
          cancel.signal
        );
        send({ type: "result", result });
      } catch (error) {
        // Detalle en el log; al cliente, el motivo corto.
        const failure = describeFailure(error);
        if (failure.kind === "cancelled") {
          console.log(`Goal analysis cancelled at stage "${current}": the client disconnected.`);
        } else {
          console.error(`Goal analysis failed at stage "${current}" (${failure.kind}):`, error);
        }
        send({ type: "error", stage: current, ...failure });
      } finally {
        slot.release();
        if (open) {
          try {
            controller.close();
          } catch {
            // Ya cerrado por el cliente.
          }
        }
      }
    },
    cancel() {
      cancel.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
