import { NextRequest, NextResponse } from "next/server";
import { runGoalAnalysis, type AnalysisStage } from "@/lib/worldmodel/goal-analysis";
import { goalFromText } from "@/lib/worldmodel/goal-types";
import {
  errorReason,
  validateAnalysisRequest,
  type AnalysisEvent,
} from "@/lib/worldmodel/analysis-events";
import { assertAllowedUrl, URL_NOT_ALLOWED } from "@/lib/security/url-guard";

export const maxDuration = 300;

// Análisis con progreso. Misma entrada que /api/goal, pero responde con un
// stream NDJSON: un evento "stage" cada vez que el motor entra en una
// etapa, y al final un "result" con el RouteComparison completo o un
// "error" con el motivo y la etapa en la que falló.
//
// /api/goal sigue devolviendo el JSON completo al final: lo usa el
// GoalReport del MVP viejo, que no se toca.
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const validation = validateAnalysisRequest(body);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }
  const { url, goal, personaMode, customPersona } = validation.request;

  // Esquema, host, puerto y la IP resuelta, antes de abrir el navegador.
  // El proxy del navegador vuelve a validar cada conexión (redirecciones
  // incluidas).
  try {
    await assertAllowedUrl(url);
  } catch {
    return NextResponse.json({ error: URL_NOT_ALLOWED }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: AnalysisEvent) =>
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));

      let current: AnalysisStage | null = null;
      try {
        const result = await runGoalAnalysis(url, goalFromText(goal), personaMode, customPersona, (stage) => {
          current = stage;
          send({ type: "stage", stage });
        });
        send({ type: "result", result });
      } catch (error) {
        console.error(`Goal analysis failed at stage "${current}":`, error);
        send({ type: "error", message: errorReason(error), stage: current });
      } finally {
        controller.close();
      }
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
