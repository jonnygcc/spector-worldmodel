import { GoogleGenAI } from "@google/genai";

let lastCallTime = 0;
const MIN_INTERVAL_MS = 4500; // ~13 requests per minute, por debajo del limite de 15

async function waitForRateLimit() {
  const now = Date.now();
  const elapsed = now - lastCallTime;
  if (elapsed < MIN_INTERVAL_MS) {
    await new Promise((r) => setTimeout(r, MIN_INTERVAL_MS - elapsed));
  }
  lastCallTime = Date.now();
}

if (!process.env.GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY is not set in environment variables");
}

export const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

export const MODEL = "gemini-3.5-flash-lite"; // or gemini-3.8.flash

export async function askGemini(prompt: string, maxRetries = 3): Promise<string> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await waitForRateLimit();
      const response = await ai.models.generateContent({
        model: MODEL,
        contents: prompt,
      });
      return response.text ?? "";
    } catch (error: unknown) {
      // ... resto igual
    }
  }
  throw lastError;
}

export function cleanJsonResponse(text: string): string {
  return text
    .replace(/```json\n?/g, "")
    .replace(/```\n?/g, "")
    .trim();
}