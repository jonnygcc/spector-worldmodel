import { NextRequest, NextResponse } from "next/server";
import { runGoalAnalysis } from "@/lib/worldmodel/goal-analysis";
import { GOALS, GoalId, PersonaMode } from "@/lib/worldmodel/goal-types";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { url, goalId, personaMode, customPersona } = body as {
      url?: string;
      goalId?: string;
      personaMode?: string;
      customPersona?: string;
    };

    if (!url) {
      return NextResponse.json({ error: "URL is required" }, { status: 400 });
    }

    try {
      new URL(url);
    } catch {
      return NextResponse.json({ error: "Invalid URL format" }, { status: 400 });
    }

    if (!goalId || !(goalId in GOALS)) {
      return NextResponse.json(
        { error: "A valid goal is required" },
        { status: 400 }
      );
    }

    const mode: PersonaMode = personaMode === "personal" ? "personal" : "automatic";

    if (mode === "personal" && (!customPersona || customPersona.trim().length < 10)) {
      return NextResponse.json(
        { error: "Describe your user in at least a few words" },
        { status: 400 }
      );
    }

    const result = await runGoalAnalysis(
      url,
      goalId as GoalId,
      mode,
      customPersona
    );

    return NextResponse.json(result);
  } catch (error) {
    console.error("Goal analysis error:", error);
    return NextResponse.json(
      { error: "Analysis failed. Please try again." },
      { status: 500 }
    );
  }
}