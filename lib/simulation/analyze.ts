import { GoogleGenAI } from "@google/genai";
import { PageCapture } from "./capture";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export interface Finding {
  title: string;
  description: string;
  severity: "high" | "medium" | "low";
  step: string;
}

export async function analyzeUX(capture: PageCapture): Promise<Finding[]> {
  const prompt = `You are Spector, an expert UX auditor. Analyze this web page capture and simulate a typical user journey. Identify friction points and usability issues.

PAGE DATA:
- URL: ${capture.url}
- Title: ${capture.title}
- Meta description: ${capture.metaDescription || "None"}
- Headings: ${capture.headings.length > 0 ? capture.headings.join(", ") : "None found"}
- Links found: ${capture.links.length} (examples: ${capture.links.slice(0, 5).map((l) => l.text).join(", ")})
- Buttons found: ${capture.buttons.length} (labels: ${capture.buttons.filter((b) => b.length < 50).join(", ")})
- Forms: ${capture.forms}
- Images: ${capture.images.length} (${capture.images.filter((i) => !i.alt).length} missing alt text)

INSTRUCTIONS:
1. Simulate a user journey step by step (landing, exploring, interacting)
2. Identify 3 to 6 UX issues found during the journey
3. Classify each as high, medium, or low severity

Respond ONLY with a valid JSON array. No markdown, no explanation. Each object must have exactly these fields:
- "title": short issue name (under 10 words)
- "description": one sentence explaining the problem and its impact
- "severity": "high", "medium", or "low"
- "step": which journey step revealed this (e.g. "Step 1: Landing page load")

Example format:
[{"title":"...","description":"...","severity":"high","step":"Step 1: ..."}]`;

  const response = await ai.models.generateContent({
    model: "gemini-3.8-flash",
    contents: prompt,
  });

  const text = response.text ?? "";

  try {
    const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const findings: Finding[] = JSON.parse(cleaned);
    return findings;
  } catch {
    return [
      {
        title: "Analysis parsing error",
        description: "The AI response could not be parsed. Try again.",
        severity: "medium",
        step: "Step 0: Analysis",
      },
    ];
  }
}