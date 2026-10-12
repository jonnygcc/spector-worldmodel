import { NextRequest, NextResponse } from "next/server";
import { capturePage } from "@/lib/simulation/capture";
import { analyzeUX } from "@/lib/simulation/analyze";

export async function POST(request: NextRequest) {
  try {
    const { url } = await request.json();

    if (!url) {
      return NextResponse.json({ error: "URL is required" }, { status: 400 });
    }

    try {
      new URL(url);
    } catch {
      return NextResponse.json(
        { error: "Invalid URL format" },
        { status: 400 }
      );
    }

    const capture = await capturePage(url);
    const findings = await analyzeUX(capture);

    return NextResponse.json({ url, findings });
  } catch (error) {
    console.error("Analysis error:", error);
    return NextResponse.json(
      { error: "Analysis failed. Please try again." },
      { status: 500 }
    );
  }
}