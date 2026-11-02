import { GoogleGenAI, type GenerateContentConfig } from "@google/genai";

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

// El único modelo de Gemini del proyecto: lo usan el Agent y el World
// Model. gemini-3.8-flash se probó para el World Model y fallaba (503 por
// demanda, 429 por cuota, o no respondía en 25s).
export const GEMINI_MODEL = "gemini-3.5-flash-lite";

// `signal`: cancela la llamada en curso y los reintentos (el World Model
// le pone un tiempo máximo). `config`: límites de salida y formato
// (maxOutputTokens, responseMimeType).
export async function askGemini(
  prompt: string,
  maxRetries = 3,
  { signal, config }: { signal?: AbortSignal; config?: GenerateContentConfig } = {}
): Promise<string> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    if (signal?.aborted) break;
    try {
      await waitForRateLimit();
      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: prompt,
        config: { ...config, abortSignal: signal },
      });
      return response.text ?? "";
    } catch (error: unknown) {
      // Se guarda para relanzarlo si fallan todos los intentos: sin esto
      // se lanzaba `undefined` y el motivo real del fallo se perdía.
      lastError = error;
      console.error(`[Gemini] attempt ${attempt}/${maxRetries} failed:`, error);
    }
  }
  throw lastError ?? new Error("Gemini call aborted");
}

// Respuesta con sus metadatos: el World Model necesita saber por qué paró
// el modelo (STOP, MAX_TOKENS, SAFETY…) y cuántos tokens usó, para el log.
// Un solo intento: quien llama decide si reintenta.
export interface GeminiAnswer {
  text: string;
  finishReason: string;
  promptTokens?: number;
  outputTokens?: number;
}

export async function askGeminiDetailed(
  prompt: string,
  { signal, config }: { signal?: AbortSignal; config?: GenerateContentConfig } = {}
): Promise<GeminiAnswer> {
  await waitForRateLimit();
  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: prompt,
    config: { ...config, abortSignal: signal },
  });
  return {
    text: response.text ?? "",
    finishReason: response.candidates?.[0]?.finishReason ?? "UNKNOWN",
    promptTokens: response.usageMetadata?.promptTokenCount,
    outputTokens: response.usageMetadata?.candidatesTokenCount,
  };
}

export function cleanJsonResponse(text: string): string {
  return text
    .replace(/```json\n?/g, "")
    .replace(/```\n?/g, "")
    .trim();
}