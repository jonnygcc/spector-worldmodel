import { GoogleGenAI, type GenerateContentConfig, type Schema } from "@google/genai";
import { dataMessage, MAX_DATA_CHARS } from "./prompt-data";
import { ModelQuotaError, quotaInfo, statusOf } from "./model-errors";
import { currentAnalysisSignal } from "../security/browser-sandbox";

let lastCallTime = 0;
const MIN_INTERVAL_MS = 4500; // ~13 requests per minute, under the free tier's 15

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

// The project's only Gemini model, for both Agent and World Model. gemini-3.8-flash was tried
// for the World Model and failed (503 under load, 429 on quota, or no answer within 25s).
export const GEMINI_MODEL = "gemini-3.5-flash-lite";

// Instructions go through systemInstruction with trusted values only; site content travels
// separately as the {"page_data": …} user message, never concatenated (prompt injection).
export interface ModelRequest {
  system: string;
  pageData?: unknown;
  schema: Schema;
  maxOutputTokens?: number;
}

// The longest answer (5 routes, or 6 steps with expectations) is about 1,500 tokens.
const OUTPUT_TOKENS = 4096;

// Exported for the World Model, which also sends it to OpenRouter.
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

// A wait that ends early if the call is aborted.
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

// Retrying a 429 right away always fails and spends another request: wait for Gemini's
// retryDelay (or back off), and give up with ModelQuotaError if the wait would be too long.
const MAX_QUOTA_WAIT_MS = 20_000;
const QUOTA_BACKOFF_MS = [8_000, 16_000];
// Network failures or 5xx: short backoff.
const ERROR_BACKOFF_MS = [2_000, 4_000];

// Defaults to the running analysis's signal, so a deadline or a client disconnect cuts the call.
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
      // Kept to rethrow if every attempt fails; otherwise `undefined` was thrown and the real cause lost.
      lastError = error;
      // Cancelled (deadline or client gone): not a model failure.
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
      // Any other 4xx (bad request, rejected key): retrying changes nothing.
      const status = statusOf(error);
      if (status !== null && status >= 400 && status < 500) throw error;
      if (attempt < maxRetries) await sleep(ERROR_BACKOFF_MS[attempt - 1] ?? 4_000, signal);
    }
  }
  throw lastError ?? new Error("Gemini call aborted");
}

// The World Model needs the finish reason (STOP, MAX_TOKENS, SAFETY…) and token counts for its log.
// Single attempt: the caller decides whether to retry.
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
