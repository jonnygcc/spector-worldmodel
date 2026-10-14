import { NextRequest, NextResponse } from "next/server";
import { runWhatIf } from "@/lib/worldmodel/whatif-runner";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const { url, question } = await request.json();

    if (!url) {
      return NextResponse.json({ error: "URL is required" }, { status: 400 });
    }

    if (!question || question.trim().length < 5) {
      return NextResponse.json(
        { error: "Please write a question with at least a few words" },
        { status: 400 }
      );
    }

    try {
      new URL(url);
    } catch {
      return NextResponse.json({ error: "Invalid URL format" }, { status: 400 });
    }

    const journey = await runWhatIf(url, question.trim());
    return NextResponse.json(journey);
  } catch (error) {
    console.error("What-if error:", error);
    return NextResponse.json(
      { error: "Simulation failed. Please try again." },
      { status: 500 }
    );
  }
}