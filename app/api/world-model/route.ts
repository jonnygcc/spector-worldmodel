import { NextRequest, NextResponse } from "next/server";
import { predictDetours, type WorldModelOutcome } from "@/lib/worldmodel/world-model";
import { validateWorldModelInput } from "@/lib/worldmodel/world-model-input";
import { checkApiRequest, readBody } from "@/lib/security/request-guard";
import { createLimiter, PREDICTION_LIMIT } from "@/lib/security/usage-limit";
import { describeFailure, type Failure } from "@/lib/llm/model-errors";

// Predicción del World Model, aparte del análisis del agente: la pide la
// UI cuando el reporte del agente ya está en pantalla (y con Retry).
// Entrada: WorldModelInput, ya compacto (sin HTML ni capturas). Responde
// con WorldModelOutcome: { ok: true, scenarios, model } o { ok: false,
// reason, kind, retryable, retryAfterSeconds }. El motor tiene su propio
// tiempo máximo (25s).
export const maxDuration = 60;

// Tope del cuerpo: la entrada ya viene recortada; más que esto no es una
// entrada válida.
const MAX_BODY = 20_000;

// Una predicción a la vez y un tope por ventana (usage-limit.ts).
const limiter = createLimiter(PREDICTION_LIMIT);

function failed(status: number, failure: Failure) {
  const outcome: WorldModelOutcome = { ok: false, reason: failure.message, ...failure };
  return NextResponse.json(outcome, {
    status,
    headers: failure.retryAfterSeconds ? { "Retry-After": String(failure.retryAfterSeconds) } : undefined,
  });
}

const invalid = (status: number, message: string) => failed(status, { kind: "unknown", message, retryable: false });

// Antes de gastar una llamada al modelo (paso 9): origen y tipo de
// contenido, tamaño, esquema estricto y límite de uso.
export async function POST(request: NextRequest) {
  const guard = checkApiRequest(request.headers);
  if (!guard.ok) return invalid(guard.status, guard.error);

  const raw = await readBody(request, MAX_BODY);
  if (!raw.ok) return invalid(raw.status, "The captured page is too large to predict.");

  let body: unknown;
  try {
    body = JSON.parse(raw.text);
  } catch {
    return invalid(400, "Invalid request.");
  }
  const validation = validateWorldModelInput(body);
  if (!validation.ok) return invalid(400, validation.error);

  const slot = limiter.acquire();
  if (!slot.ok) {
    return failed(429, { kind: "busy", message: slot.message, retryable: true, retryAfterSeconds: slot.retryAfterSeconds });
  }

  // predictDetours ya convierte los fallos del modelo en { ok: false }.
  // Esto atrapa lo demás (un bug del motor) con su stack completo en el
  // log del servidor, y la UI recibe su error con Retry en vez de un 500.
  try {
    const outcome = await predictDetours(validation.input, request.signal);
    return NextResponse.json(outcome, {
      headers:
        !outcome.ok && outcome.retryAfterSeconds ? { "Retry-After": String(outcome.retryAfterSeconds) } : undefined,
    });
  } catch (error) {
    console.error("[WorldModel] Endpoint failed:", error instanceof Error ? error.stack : error);
    const failure = describeFailure(error);
    return failed(500, failure.kind === "unknown" ? { ...failure, message: "The prediction service failed." } : failure);
  } finally {
    slot.release();
  }
}
