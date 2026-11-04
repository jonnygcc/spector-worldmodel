import { NextRequest, NextResponse } from "next/server";
import { runGoalAnalysis, type AnalysisStage } from "@/lib/worldmodel/goal-analysis";
import { goalFromText } from "@/lib/worldmodel/goal-types";
import {
  MAX_ANALYSIS_BODY,
  validateAnalysisRequest,
  type AnalysisEvent,
} from "@/lib/worldmodel/analysis-events";
import { assertAllowedUrl, URL_NOT_ALLOWED } from "@/lib/security/url-guard";
import { checkApiRequest, linkAbort, readBody } from "@/lib/security/request-guard";
import { ANALYSIS_LIMIT, createLimiter } from "@/lib/security/usage-limit";
import { describeFailure, type Failure } from "@/lib/llm/model-errors";

export const maxDuration = 300;

// One analysis at a time plus a per-window cap: protects the user's Gemini quota.
const limiter = createLimiter(ANALYSIS_LIMIT);

// Retry-After mirrors retryAfterSeconds for clients that only read headers.
function reject(status: number, error: string, failure?: Omit<Failure, "message">) {
  return NextResponse.json(
    { error, ...failure },
    {
      status,
      headers: failure?.retryAfterSeconds ? { "Retry-After": String(failure.retryAfterSeconds) } : undefined,
    }
  );
}

// NDJSON: "stage" events, then one "result" or "error". Every check runs before a
// browser or model call is spent, and a client disconnect aborts the analysis.
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

  // Fail before opening the browser; the egress proxy still re-checks every connection.
  try {
    await assertAllowedUrl(url);
  } catch {
    return reject(400, URL_NOT_ALLOWED, { kind: "not-allowed", retryable: false });
  }

  // Nobody will read this stream, so don't take the only slot. 499 = client closed request.
  if (request.signal.aborted) {
    return reject(499, "The request was cancelled.", { kind: "cancelled", retryable: true });
  }

  const slot = limiter.acquire();
  if (!slot.ok) {
    return reject(429, slot.message, { kind: "busy", retryable: true, retryAfterSeconds: slot.retryAfterSeconds });
  }

  // Next never calls the stream's cancel() if the socket closed before the response.
  const cancel = new AbortController();
  const unlink = linkAbort(request.signal, cancel);

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
        // Details go to the server log; the client only gets the short reason.
        const failure = describeFailure(error);
        if (failure.kind === "cancelled") {
          console.log(`Goal analysis cancelled at stage "${current}": the client disconnected.`);
        } else {
          console.error(`Goal analysis failed at stage "${current}" (${failure.kind}):`, error);
        }
        send({ type: "error", stage: current, ...failure });
      } finally {
        unlink();
        slot.release();
        if (open) {
          try {
            controller.close();
          } catch {
            // Already closed by the client.
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
