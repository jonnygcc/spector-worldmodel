import { NextRequest, NextResponse } from "next/server";
import { predictDetours } from "@/lib/worldmodel/world-model";
import type { WorldModelInput } from "@/lib/worldmodel/world-model-input";

// Predicción del World Model, aparte del análisis del agente: la pide la
// UI cuando el reporte del agente ya está en pantalla (y con Retry).
// Entrada: WorldModelInput, ya compacto (sin HTML ni capturas). Responde
// siempre 200 con WorldModelOutcome: { ok: true, scenarios, model } o
// { ok: false, reason }. El motor tiene su propio tiempo máximo (25s).
export const maxDuration = 60;

// Tope del cuerpo: la entrada ya viene recortada; más que esto no es una
// entrada válida.
const MAX_BODY = 20_000;

export async function POST(request: NextRequest) {
  const raw = await request.text().catch(() => "");
  if (raw.length > MAX_BODY) {
    return NextResponse.json({ ok: false, reason: "The captured page is too large to predict." }, { status: 413 });
  }

  let input: Partial<WorldModelInput>;
  try {
    input = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false, reason: "Invalid request." }, { status: 400 });
  }
  const { url, goal, pageContext, happyPath } = input;
  if (![url, goal, pageContext, happyPath].every((v) => typeof v === "string") || !goal!.trim()) {
    return NextResponse.json({ ok: false, reason: "Invalid request." }, { status: 400 });
  }

  // predictDetours ya convierte los fallos del modelo en { ok: false }.
  // Esto atrapa lo demás (un bug del motor) con su stack completo en el
  // log del servidor, y la UI recibe su error con Retry en vez de un 500.
  try {
    const outcome = await predictDetours({
      url: url!,
      goal: goal!,
      pageContext: pageContext!,
      happyPath: happyPath!,
    });
    return NextResponse.json(outcome);
  } catch (error) {
    console.error("[WorldModel] Endpoint failed:", error instanceof Error ? error.stack : error);
    return NextResponse.json(
      { ok: false, reason: `The prediction service failed: ${(error as Error)?.message ?? "unknown error"}` },
      { status: 500 }
    );
  }
}
