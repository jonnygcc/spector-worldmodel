import { NextRequest, NextResponse } from "next/server";
import { predictDetours, type WorldModelOutcome } from "@/lib/worldmodel/world-model";
import { validateWorldModelInput } from "@/lib/worldmodel/world-model-input";
import { checkApiRequest, readBody } from "@/lib/security/request-guard";
import { createLimiter, PREDICTION_LIMIT } from "@/lib/security/usage-limit";
import { describeFailure, type Failure } from "@/lib/llm/model-errors";

// Requested by the UI once the agent report is on screen, so a slow or rate-limited
// prediction never holds the report back.
export const maxDuration = 60;

// The client already truncates its input; anything bigger is not a valid request.
const MAX_BODY = 20_000;

// One prediction at a time plus a per-window cap (usage-limit.ts).
const limiter = createLimiter(PREDICTION_LIMIT);

function failed(status: number, failure: Failure) {
  const outcome: WorldModelOutcome = { ok: false, reason: failure.message, ...failure };
  return NextResponse.json(outcome, {
    status,
    headers: failure.retryAfterSeconds ? { "Retry-After": String(failure.retryAfterSeconds) } : undefined,
  });
}

const invalid = (status: number, message: string) => failed(status, { kind: "unknown", message, retryable: false });

// Every check runs before a model call is spent.
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

  // predictDetours already turns model failures into { ok: false }; this catches engine bugs,
  // logs the stack and still gives the UI a retryable error instead of a 500.
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
