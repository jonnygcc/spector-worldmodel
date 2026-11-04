import { GoogleGenAI, type GenerateContentConfig, type Schema } from "@google/genai";
import { dataMessage, MAX_DATA_CHARS } from "./prompt-data";
import { ModelQuotaError, quotaInfo, statusOf } from "./model-errors";
import { currentAnalysisSignal } from "../security/browser-sandbox";

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

// Una llamada al modelo (inyección de prompt, paso 7):
// - `system`: las instrucciones, por systemInstruction. Solo llevan
//   valores de confianza (objetivo y perfil del usuario).
// - `pageData`: lo que viene del sitio analizado, como único mensaje del
//   usuario: {"page_data": …}. Nunca se concatena con las instrucciones.
// - `schema`: la forma de la respuesta (responseSchema).
export interface ModelRequest {
  system: string;
  pageData?: unknown;
  schema: Schema;
  maxOutputTokens?: number;
}

// Tope de la salida de cada llamada. La respuesta más larga (5 rutas o 6
// pasos con sus expectativas) ronda los 1.500 tokens.
const OUTPUT_TOKENS = 4096;

// El mensaje de datos de una petición, con su tope. Exportado para el
// World Model, que lo manda también a OpenRouter.
export function contentsOf(request: ModelRequest): string {
  const contents = dataMessage(request.pageData);
  if (contents.length > MAX_DATA_CHARS) {
    throw new Error(`The page data is too large to send to the model (${contents.length} characters).`);
  }
  return contents;
}

function configOf(request: ModelRequest, signal?: AbortSignal): GenerateContentConfig {
  return {
    systemInstruction: request.system,
    responseMimeType: "application/json",
    responseSchema: request.schema,
    maxOutputTokens: request.maxOutputTokens ?? OUTPUT_TOKENS,
    abortSignal: signal,
  };
}

// Espera que se corta si se aborta la llamada.
const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new Error("aborted"));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new Error("aborted"));
      },
      { once: true }
    );
  });

// Ante un 429 se espera lo que dice Gemini (RetryInfo.retryDelay) o, sin
// ese dato, con backoff. Si hay que esperar más que esto, no se reintenta:
// se falla con ModelQuotaError y el cliente ve cuándo volver a probar.
// Reintentar de inmediato contra una cuota agotada siempre falla y gasta
// otra petición.
const MAX_QUOTA_WAIT_MS = 20_000;
const QUOTA_BACKOFF_MS = [8_000, 16_000];
// Fallos de red o 5xx: backoff corto.
const ERROR_BACKOFF_MS = [2_000, 4_000];

// `signal`: cancela la llamada en curso y los reintentos. Sin `signal`, el
// del análisis en curso: si el plazo vence o el cliente se desconecta, la
// llamada se corta (browser-sandbox.ts).
export async function askGemini(
  request: ModelRequest,
  maxRetries = 3,
  { signal = currentAnalysisSignal() }: { signal?: AbortSignal } = {}
): Promise<string> {
  const contents = contentsOf(request);
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    if (signal?.aborted) throw signal.reason ?? new Error("Gemini call aborted");
    try {
      await waitForRateLimit();
      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents,
        config: configOf(request, signal),
      });
      return response.text ?? "";
    } catch (error: unknown) {
      // Se guarda para relanzarlo si fallan todos los intentos: sin esto
      // se lanzaba `undefined` y el motivo real del fallo se perdía.
      lastError = error;
      // Cancelada (plazo o cliente desconectado): no es un fallo del modelo.
      if (signal?.aborted) {
        console.log("[Gemini] call aborted: the analysis ended.");
        throw signal.reason ?? error;
      }
      console.error(`[Gemini] attempt ${attempt}/${maxRetries} failed:`, error);

      const quota = quotaInfo(error);
      if (quota) {
        const wait = quota.retryAfterMs ?? QUOTA_BACKOFF_MS[attempt - 1] ?? Infinity;
        if (quota.daily || attempt >= maxRetries || wait > MAX_QUOTA_WAIT_MS) {
          throw new ModelQuotaError(quota.retryAfterMs, quota.daily);
        }
        console.warn(`[Gemini] rate limited: waiting ${Math.round(wait / 1000)}s before retrying.`);
        await sleep(wait, signal);
        continue;
      }
      // Otro 4xx (petición inválida, clave rechazada): reintentar no cambia nada.
      const status = statusOf(error);
      if (status !== null && status >= 400 && status < 500) throw error;
      if (attempt < maxRetries) await sleep(ERROR_BACKOFF_MS[attempt - 1] ?? 4_000, signal);
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
  request: ModelRequest,
  { signal }: { signal?: AbortSignal } = {}
): Promise<GeminiAnswer> {
  const contents = contentsOf(request);
  await waitForRateLimit();
  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents,
    config: configOf(request, signal),
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
