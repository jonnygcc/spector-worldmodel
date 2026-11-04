import { WMKind, WMScenario, StepNode } from "./report-contract";
import { HAPPY_PATH_MAX, PAGE_CONTEXT_MAX, truncate, type WorldModelInput } from "./world-model-input";
import { Type, type Schema } from "@google/genai";
import {
  askGeminiDetailed,
  cleanJsonResponse,
  contentsOf,
  GEMINI_MODEL,
  type GeminiAnswer,
  type ModelRequest,
} from "../llm/gemini";
import { PROMPTS } from "../llm/prompts";
import { fill } from "../llm/prompt-data";
import { pickFailure, quotaInfo, statusOf, type Failure } from "../llm/model-errors";

// One model call, no browsing, from the first captured state and the agent's measured route. The
// provider (WORLD_MODEL_PROVIDER) falls back to the other one if configured; TIMEOUT_MS bounds the chain.

const TIMEOUT_MS = Number(process.env.WORLD_MODEL_TIMEOUT_MS) || 25_000;
const SCENARIOS = 3;
const KINDS: WMKind[] = ["Alternative route", "User error", "UI confusion", "Flow block"];
const STATUSES: WMScenario["status"][] = ["success", "friction", "blocked"];
const MAX_RECOMMENDATION = 160;
const MAX_LABEL = 60;
const MAX_NAME = 80;
const MAX_STEP_NODES = 8;
// Calls per provider when the answer can't be read: the original plus one retry.
const PARSE_ATTEMPTS = 2;

export type WorldModelOutcome =
  | { ok: true; scenarios: WMScenario[]; model: string }
  // `reason` is the short message (Failure.message); kind, retryable and retryAfterSeconds tell whether
  // and when Retry helps.
  | ({ ok: false; reason: string } & Failure);

// ---- Providers ----
type Provider = "gemini" | "openrouter";

// 3 scenarios take ~700 tokens; the margin keeps a long answer from being cut (MAX_TOKENS) mid-JSON.
const OUTPUT_TOKENS = 4096;

// goalCheck and reachesGoal are required so the model always fills what the guardrails need. Length
// caps live here too, besides toScenario's sanitizing.
const SCENARIO_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    scenarios: {
      type: Type.ARRAY,
      maxItems: String(SCENARIOS),
      items: {
        type: Type.OBJECT,
        properties: {
          user: { type: Type.STRING, description: "Short scenario name, max 6 words" },
          subtitle: { type: Type.STRING, enum: [...KINDS] },
          probability: { type: Type.INTEGER, description: "0-100" },
          steps: { type: Type.INTEGER },
          friction: { type: Type.INTEGER, description: "0-100, higher is worse" },
          status: { type: Type.STRING, enum: [...STATUSES] },
          reachedSteps: { type: Type.INTEGER },
          recommendation: {
            type: Type.STRING,
            maxLength: String(MAX_RECOMMENDATION),
            description: `One sentence, max ${MAX_RECOMMENDATION} characters`,
          },
          stepNodes: {
            type: Type.ARRAY,
            maxItems: String(MAX_STEP_NODES),
            items: {
              type: Type.OBJECT,
              properties: {
                index: { type: Type.INTEGER },
                label: {
                  type: Type.STRING,
                  maxLength: String(MAX_LABEL),
                  description: "One short imperative action, max 8 words",
                },
              },
              required: ["index", "label"],
              propertyOrdering: ["index", "label"],
            },
          },
          goalCheck: { type: Type.STRING, description: "How the scenario ends relative to the goal, in the goal's own words" },
          reachesGoal: { type: Type.BOOLEAN, description: "true if the last step completes the goal" },
        },
        required: [
          "user", "subtitle", "probability", "steps", "friction",
          "status", "reachedSteps", "recommendation", "stepNodes", "goalCheck", "reachesGoal",
        ],
        propertyOrdering: [
          "user", "subtitle", "probability", "steps", "friction", "status",
          "reachedSteps", "recommendation", "stepNodes", "goalCheck", "reachesGoal",
        ],
      },
    },
  },
  required: ["scenarios"],
};

// Provider error with its HTTP status, like @google/genai's ApiError.
class ProviderError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

// Same two parts as with Gemini: instructions as the "system" message, site data as the only "user" one.
async function askOpenRouter(request: ModelRequest, signal: AbortSignal): Promise<GeminiAnswer> {
  const key = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_MODEL;
  if (!key || !model) throw new Error("OpenRouter is not configured (OPENROUTER_API_KEY, OPENROUTER_MODEL)");
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: request.system },
        { role: "user", content: contentsOf(request) },
      ],
      response_format: { type: "json_object" },
      max_tokens: OUTPUT_TOKENS,
    }),
    signal,
  });
  if (!response.ok) {
    throw new ProviderError(`OpenRouter: ${(await response.text()).slice(0, 300)}`, response.status);
  }
  const data = (await response.json()) as {
    choices?: { message?: { content?: string }; finish_reason?: string }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  // Gemini's names: "stop" → STOP, "length" → MAX_TOKENS.
  const finish = data.choices?.[0]?.finish_reason;
  return {
    text: data.choices?.[0]?.message?.content ?? "",
    finishReason: finish === "stop" ? "STOP" : finish === "length" ? "MAX_TOKENS" : (finish ?? "UNKNOWN").toUpperCase(),
    promptTokens: data.usage?.prompt_tokens,
    outputTokens: data.usage?.completion_tokens,
  };
}

function providerOrder(): Provider[] {
  const order: Provider[] =
    process.env.WORLD_MODEL_PROVIDER === "openrouter" ? ["openrouter", "gemini"] : ["gemini", "openrouter"];
  const configured = (p: Provider) =>
    p === "openrouter" ? !!(process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_MODEL) : !!process.env.GEMINI_API_KEY;
  return order.filter(configured);
}

// No network retries: providers share TIMEOUT_MS, and if the free tier throttles it's better to move on.
const ask = (provider: Provider, request: ModelRequest, signal: AbortSignal) =>
  provider === "openrouter" ? askOpenRouter(request, signal) : askGeminiDetailed(request, { signal });

const modelName = (provider: Provider) =>
  provider === "openrouter" ? (process.env.OPENROUTER_MODEL ?? "openrouter") : GEMINI_MODEL;

// ---- Validation: from the model's JSON to scenarios ----
const STOPWORDS = new Set(
  "the a an to for of and or in on at by with from into your my our this that some something someone thing things".split(" ")
);

// Goal words that must appear in the scenario. Naive stemming (no trailing s); bag/basket count as
// cart, as in the matcher.
const keywords = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/\b(bag|basket)\b/g, "cart")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w))
    .map((w) => w.replace(/s$/, ""));

const clampInt = (value: unknown, min: number, max: number, fallback: number) => {
  const n = typeof value === "number" ? value : Number.parseFloat(String(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
};

const shorten = (text: string, max: number) => {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
};

// The model sometimes glues the label to the text after it ("Click FeaturesEverything…"); long labels
// are cut at a lowercase-uppercase join (short ones aren't, to keep "YouTube"), then capped without "…".
const MAX_LABEL_WORDS = 8;
function cleanLabel(text: string): string {
  let label = text.replace(/\s+/g, " ").trim();
  const long = () => label.length > MAX_LABEL || label.split(" ").length > MAX_LABEL_WORDS;
  if (long()) {
    const glue = label.search(/[a-z][A-Z]/);
    if (glue > 0) label = label.slice(0, glue + 1);
  }
  label = label.split(" ").slice(0, MAX_LABEL_WORDS).join(" ");
  if (label.length > MAX_LABEL) {
    const cut = label.lastIndexOf(" ", MAX_LABEL);
    label = label.slice(0, cut > 0 ? cut : MAX_LABEL);
  }
  return label.replace(/[\s,;:.–—-]+$/, "");
}

// A recommendation is one sentence: keep the first.
const firstSentence = (text: string) => {
  const clean = text.replace(/\s+/g, " ").trim();
  const end = clean.search(/[.!?](\s|$)/);
  return end === -1 ? clean : clean.slice(0, end + 1);
};

interface RawScenario {
  user?: unknown;
  subtitle?: unknown;
  probability?: unknown;
  steps?: unknown;
  friction?: unknown;
  status?: unknown;
  reachedSteps?: unknown;
  stepNodes?: unknown;
  recommendation?: unknown;
  goalCheck?: unknown;
  reachesGoal?: unknown;
}

// Variants ("Success", "BLOCKED", "user-error"…) are normalized, never a reason to drop. An unknown
// kind takes the one matching its status.
const normalize = (value: unknown) =>
  String(value ?? "").trim().toLowerCase().replace(/[\s_-]+/g, " ");

function scenarioStatus(value: unknown): WMScenario["status"] | null {
  const s = normalize(value);
  if (s.includes("success")) return "success";
  if (s.includes("friction")) return "friction";
  if (s.includes("block")) return "blocked";
  return null;
}

const KIND_BY_STATUS: Record<WMScenario["status"], WMKind> = {
  success: "Alternative route",
  friction: "UI confusion",
  blocked: "Flow block",
};

function kindOf(value: unknown, status: WMScenario["status"]): WMKind {
  const s = normalize(value);
  return (
    KINDS.find((k) => k.toLowerCase() === s) ??
    (s.includes("route") || s.includes("alternative")
      ? "Alternative route"
      : s.includes("error")
        ? "User error"
        : s.includes("confus")
          ? "UI confusion"
          : s.includes("block")
            ? "Flow block"
            : KIND_BY_STATUS[status])
  );
}

function toScenario(raw: RawScenario, goalWords: string[]): WMScenario | string {
  const name = typeof raw.user === "string" ? shorten(raw.user, MAX_NAME) : "";
  if (!name) return "no name";
  let status = scenarioStatus(raw.status);
  if (!status) return `unknown status "${String(raw.status)}"`;
  // Caps truncate, never drop. Without a recommendation the scenario stays; the row just has no card.
  const recommendation =
    typeof raw.recommendation === "string"
      ? shorten(firstSentence(raw.recommendation), MAX_RECOMMENDATION)
      : "";

  const stepNodes: StepNode[] = (Array.isArray(raw.stepNodes) ? raw.stepNodes : [])
    .map((node: { index?: unknown; label?: unknown }, i) => ({
      index: clampInt(node?.index, 1, 99, i + 1),
      label: typeof node?.label === "string" ? cleanLabel(node.label) : "",
    }))
    .filter((node) => node.label)
    .sort((a, b) => a.index - b.index)
    .slice(0, MAX_STEP_NODES)
    // Consecutive 1..n indexes, no screenshots: it's a prediction.
    .map((node, i) => ({ index: i + 1, label: node.label }));
  if (stepNodes.length === 0) return "no step nodes";

  // Off-goal net (the prompt already forbids it), only with goalCheck: without it there's nothing to
  // compare on a site in another language (goal "Translator", steps "Traducir texto"), so it stays.
  const goalCheck = typeof raw.goalCheck === "string" ? raw.goalCheck : "";
  const text = keywords([name, goalCheck, ...stepNodes.map((n) => n.label)].join(" "));
  if (goalCheck && goalWords.length > 0 && !goalWords.some((w) => text.includes(w))) {
    return "unrelated to the goal";
  }

  // Searching goal words in the last step dropped everything on sites in another language or with synonyms;
  // now a success/friction that doesn't reach the goal becomes blocked instead of being dropped.
  if (status !== "blocked" && raw.reachesGoal === false) {
    console.log(`[WorldModel] "${name}": ${status} but reachesGoal is false, kept as blocked`);
    status = "blocked";
  }
  const kind = kindOf(raw.subtitle, status);

  const steps = clampInt(raw.steps, stepNodes.length, 30, stepNodes.length);
  // reachedSteps counts stepNodes positions (what colors the timeline); for blocked at least the last
  // one stays unreached.
  const reachedSteps =
    status === "blocked"
      ? clampInt(raw.reachedSteps, 0, stepNodes.length - 1, stepNodes.length - 1)
      : stepNodes.length;

  return {
    user: name,
    subtitle: kind,
    probability: clampInt(raw.probability, 0, 100, 0),
    steps,
    friction: clampInt(raw.friction, 0, 100, 50),
    status,
    reachedSteps,
    recommendation,
    stepNodes,
  };
}

// Kept apart from provider failures, for the log and for the reason the UI shows.
class ParseError extends Error {}

// A finish other than STOP (MAX_TOKENS, SAFETY…) cuts or empties the JSON: retried as unreadable, but
// named apart in the log.
class FinishError extends ParseError {
  constructor(readonly finishReason: string) {
    super(`Generation stopped with finishReason ${finishReason}`);
  }
}

// Defensive even with structured output: no ```json fences, only what's between the first "{" and the last "}".
function extractJson(text: string): string {
  const cleaned = cleanJsonResponse(text);
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end < start) throw new ParseError("No JSON object in the response");
  return cleaned.slice(start, end + 1);
}

// Exported to test the guardrails without calling the model.
export function parseScenarios(text: string, goal: string): WMScenario[] {
  let parsed: { scenarios?: RawScenario[] };
  try {
    parsed = JSON.parse(extractJson(text));
  } catch (error) {
    throw error instanceof ParseError ? error : new ParseError(`Invalid JSON: ${(error as Error).message}`);
  }
  if (!Array.isArray(parsed.scenarios)) throw new ParseError("Response has no scenarios array");

  const goalWords = keywords(goal);
  const seen = new Set<string>();
  const kept: WMScenario[] = [];
  const discarded: string[] = [];
  parsed.scenarios.forEach((raw, i) => {
    const result = toScenario(raw ?? {}, goalWords);
    const name = typeof raw?.user === "string" ? raw.user : `#${i + 1}`;
    if (typeof result === "string") discarded.push(`"${name}": ${result}`);
    else if (seen.has(result.user.toLowerCase())) discarded.push(`"${name}": duplicate`);
    else if (kept.length >= SCENARIOS) discarded.push(`"${name}": over the ${SCENARIOS}-scenario limit`);
    else {
      seen.add(result.user.toLowerCase());
      kept.push(result);
    }
  });
  console.log(
    `[WorldModel] ${parsed.scenarios.length} scenarios received, ${kept.length} kept, ${discarded.length} discarded` +
      (discarded.length ? `: ${discarded.join("; ")}` : ".")
  );
  return kept;
}

// ---- Orchestrator ----

// A 429 in any attempt wins over the timeout: if quota ran out, that's what to say, even if time
// ran out later.
function failureFor(errors: unknown[], timedOut: boolean): Failure {
  const failure = pickFailure(errors, {
    timedOut,
    timeoutMessage: `The prediction took longer than ${TIMEOUT_MS / 1000} seconds.`,
  });
  if (failure.kind !== "unknown") return failure;
  return {
    ...failure,
    message:
      errors[errors.length - 1] instanceof ParseError
        ? "The model's answer couldn't be read."
        : "The prediction service failed.",
  };
}

const failed = (failure: Failure): WorldModelOutcome => ({ ok: false, reason: failure.message, ...failure });

// `signal`: the request's; a client disconnect cuts the prediction.
export async function predictDetours(input: WorldModelInput, signal?: AbortSignal): Promise<WorldModelOutcome> {
  // Truncated again here: the input comes from the client.
  const pageContext = truncate(input.pageContext, PAGE_CONTEXT_MAX);
  // The goal was typed by the user: instructions. URL, captured state and measured route come from the
  // site: page_data.
  const request: ModelRequest = {
    system: fill(PROMPTS.worldModel, { GOAL: input.goal, N: String(SCENARIOS) }),
    pageData: {
      url: input.url,
      entry_state: pageContext,
      measured_happy_path: truncate(input.happyPath, HAPPY_PATH_MAX),
    },
    schema: SCENARIO_SCHEMA,
    maxOutputTokens: OUTPUT_TOKENS,
  };
  console.log(
    `[WorldModel] pageContext ${input.pageContext.length} chars (sent ${pageContext.length}), ` +
      `system ${request.system.length} chars, data ${contentsOf(request).length} chars.`
  );

  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), TIMEOUT_MS);
  const stop = signal ? AbortSignal.any([deadline.signal, signal]) : deadline.signal;
  // Every failure, in order: any quota error wins (pickFailure).
  const errors: unknown[] = [];

  try {
    for (const provider of providerOrder()) {
      // Up to PARSE_ATTEMPTS identical calls if the answer can't be read; a provider failure (network,
      // 429, 5xx) moves straight to the next one.
      for (let attempt = 1; attempt <= PARSE_ATTEMPTS; attempt++) {
        if (stop.aborted) break;
        const started = Date.now();
        const label = `${modelName(provider)} (attempt ${attempt}/${PARSE_ATTEMPTS})`;
        try {
          console.log(`[WorldModel] Predicting detours with ${label}...`);
          const answer = await ask(provider, request, stop);
          console.log(
            `[WorldModel] Raw answer: finishReason ${answer.finishReason}, ` +
              `tokens ${answer.promptTokens ?? "?"} in / ${answer.outputTokens ?? "?"} out, ` +
              `${answer.text.length} chars (${Date.now() - started} ms):\n${answer.text}`
          );
          if (answer.finishReason !== "STOP") {
            console.error(`[WorldModel] ${answer.finishReason}: the answer was cut off or withheld.`);
            throw new FinishError(answer.finishReason);
          }
          const scenarios = parseScenarios(answer.text, input.goal);
          console.log(`[WorldModel] ${scenarios.length} scenarios kept (${Date.now() - started} ms).`);
          return { ok: true, scenarios, model: modelName(provider) };
        } catch (error) {
          errors.push(error);
          const quota = quotaInfo(error);
          console.error(
            `[WorldModel] ${label} failed after ${Date.now() - started} ms:`,
            JSON.stringify({
              status: statusOf(error),
              quota: quota ? { retryAfterMs: quota.retryAfterMs, daily: quota.daily } : undefined,
              parse: error instanceof ParseError,
              finishReason: error instanceof FinishError ? error.finishReason : undefined,
              timedOut: deadline.signal.aborted,
              cancelled: signal?.aborted === true,
              message: (error as Error)?.message?.slice(0, 500),
            })
          );
          if (!(error instanceof ParseError)) break;
        }
      }
      if (stop.aborted) break;
    }
    if (signal?.aborted) {
      console.log("[WorldModel] Cancelled: the client disconnected.");
      return failed({ kind: "cancelled", message: "The prediction was cancelled.", retryable: true });
    }
    if (errors.length === 0) errors.push(new Error("No provider is configured (GEMINI_API_KEY or OPENROUTER_*)"));
    return failed(failureFor(errors, deadline.signal.aborted));
  } finally {
    clearTimeout(timer);
  }
}
