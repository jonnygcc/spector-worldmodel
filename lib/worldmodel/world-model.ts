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

// ============================================================
// World Model: detours predichos hacia el mismo objetivo
// ============================================================
// Una sola llamada al LLM, sin navegar, desde el primer estado capturado
// y la ruta que midió el agente (WorldModelInput, ya compacto). Devuelve
// WMScenario[] (sin Time ni capturas; la tabla los pinta como estimated).
//
// No va dentro del análisis del agente: lo pide la UI aparte, por
// /api/world-model, cuando el reporte del agente ya está en pantalla.
//
// Proveedor por config:
// - WORLD_MODEL_PROVIDER = "gemini" (por defecto) | "openrouter".
// - Gemini: GEMINI_MODEL, el mismo modelo que el Agent, con salida
//   estructurada (responseSchema): el JSON es válido por contrato, no por
//   pedirlo en el texto. Si aun así no se puede leer, un reintento.
// - Si el proveedor elegido falla y el otro está configurado, se prueba
//   el otro. OpenRouter necesita OPENROUTER_API_KEY y OPENROUTER_MODEL
//   (p. ej. un Qwen 3 o un DeepSeek; el id exacto, el de openrouter.ai).
//
// Toda la cadena tiene TIMEOUT_MS: al vencer se cancela la llamada en
// curso y se devuelve un fallo. Cada fallo se loguea con su estado HTTP,
// su mensaje y si fue de parseo; a la UI le llega una razón corta.

const TIMEOUT_MS = Number(process.env.WORLD_MODEL_TIMEOUT_MS) || 25_000;
const SCENARIOS = 3;
const KINDS: WMKind[] = ["Alternative route", "User error", "UI confusion", "Flow block"];
const STATUSES: WMScenario["status"][] = ["success", "friction", "blocked"];
const MAX_RECOMMENDATION = 160;
const MAX_LABEL = 60;
const MAX_NAME = 80;
const MAX_STEP_NODES = 8;
// Llamadas por proveedor cuando la respuesta no se puede leer: la
// original y un reintento.
const PARSE_ATTEMPTS = 2;

export type WorldModelOutcome =
  | { ok: true; scenarios: WMScenario[]; model: string }
  | { ok: false; reason: string };

// ------------------------------------------------------------
// Proveedores
// ------------------------------------------------------------
type Provider = "gemini" | "openrouter";

// Tope de la salida. 3 escenarios ocupan ~700 tokens; el margen evita que
// una respuesta larga se corte (MAX_TOKENS) y deje el JSON a medias.
const OUTPUT_TOKENS = 4096;

// Forma de la respuesta, como responseSchema de Gemini: { scenarios }
// con los campos de WMScenario, más goalCheck y reachesGoal (los usan los
// guardarraíles; obligatorios para que el modelo los rellene). Los topes de longitud van también aquí, además de en
// el saneado de toScenario.
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

// Error de proveedor con su estado HTTP, como el ApiError de @google/genai.
class ProviderError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

// Las mismas dos partes que en Gemini: las instrucciones como mensaje
// "system" y los datos del sitio como único mensaje "user".
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
  // Mismos nombres que Gemini: "stop" → STOP, "length" → MAX_TOKENS.
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

// Una llamada, sin reintentos de red: los proveedores comparten los
// TIMEOUT_MS, y si el free tier limita mejor pasar al siguiente.
const ask = (provider: Provider, request: ModelRequest, signal: AbortSignal) =>
  provider === "openrouter" ? askOpenRouter(request, signal) : askGeminiDetailed(request, { signal });

const modelName = (provider: Provider) =>
  provider === "openrouter" ? (process.env.OPENROUTER_MODEL ?? "openrouter") : GEMINI_MODEL;

// ------------------------------------------------------------
// Validación: del JSON del modelo a RouteRow[]
// ------------------------------------------------------------
const STOPWORDS = new Set(
  "the a an to for of and or in on at by with from into your my our this that some something someone thing things".split(" ")
);

// Palabras del objetivo que deben aparecer en el escenario. Raíz simple
// (sin s final) y bag/basket valen como cart, como en el emparejador.
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

// Label de paso: una acción corta, entera (la UI no la corta con "…").
// - Texto pegado: el modelo a veces junta la etiqueta del elemento con el
//   contenido que la sigue ("Click FeaturesEverything you need…"). Si el
//   label es largo y tiene una minúscula seguida de mayúscula sin espacio,
//   se corta ahí. Solo si es largo, para no partir nombres como "YouTube".
// - Después, como mucho MAX_LABEL_WORDS palabras y MAX_LABEL caracteres,
//   cortando en el último espacio y sin "…".
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

// La recomendación es una frase: se queda con la primera.
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

// Status y tipo tolerantes a variantes ("Success", "BLOCKED", "Alternative
// Route", "user-error"…): se normalizan antes de comparar, no se descarta
// por eso. Un tipo que no se reconoce toma el que corresponde a su status.
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

// Un escenario válido o el motivo por el que se descarta (para el log).
function toScenario(raw: RawScenario, goalWords: string[]): WMScenario | string {
  const name = typeof raw.user === "string" ? shorten(raw.user, MAX_NAME) : "";
  if (!name) return "no name";
  let status = scenarioStatus(raw.status);
  if (!status) return `unknown status "${String(raw.status)}"`;
  // Los topes recortan, nunca descartan. Sin recomendación el escenario
  // se queda; la fila simplemente no muestra la card.
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
    // Índices 1..n seguidos, sin capturas: es una predicción.
    .map((node, i) => ({ index: i + 1, label: node.label }));
  if (stepNodes.length === 0) return "no step nodes";

  // Fuera del objetivo: ninguna palabra del objetivo en el nombre, los
  // pasos ni el goalCheck. El prompt ya lo prohíbe; esto es la red. Solo
  // con goalCheck: es el campo que repite el objetivo con sus palabras.
  // Sin él no hay con qué comparar si el sitio usa otro idioma (objetivo
  // "Translator", pasos "Traducir texto"), y el escenario se queda.
  const goalCheck = typeof raw.goalCheck === "string" ? raw.goalCheck : "";
  const text = keywords([name, goalCheck, ...stepNodes.map((n) => n.label)].join(" "));
  if (goalCheck && goalWords.length > 0 && !goalWords.some((w) => text.includes(w))) {
    return "unrelated to the goal";
  }

  // Coherencia status/pasos con reachesGoal, que el modelo rellena por
  // schema. Antes se buscaban las palabras del objetivo en el último
  // paso, y eso descartaba todo cuando el sitio estaba en otro idioma o
  // usaba sinónimos ("Iniciar sesión" vs "Sign in"). Si dice success o
  // friction pero que no llega, pasa a blocked en vez de descartarse.
  if (status !== "blocked" && raw.reachesGoal === false) {
    console.log(`[WorldModel] "${name}": ${status} but reachesGoal is false, kept as blocked`);
    status = "blocked";
  }
  const kind = kindOf(raw.subtitle, status);

  const steps = clampInt(raw.steps, stepNodes.length, 30, stepNodes.length);
  // reachedSteps cuenta posiciones en stepNodes (lo que colorea el
  // timeline). Success/friction: todos. Blocked: al menos el último queda
  // sin alcanzar.
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

// Respuesta que no se puede leer como JSON con escenarios. Se distingue
// de los fallos del proveedor para el log y para la razón que ve la UI.
class ParseError extends Error {}

// El modelo paró por algo que no es STOP (MAX_TOKENS, SAFETY…): el JSON
// llega cortado o vacío. Cuenta como respuesta ilegible (se reintenta),
// pero el log lo nombra aparte.
class FinishError extends ParseError {
  constructor(readonly finishReason: string) {
    super(`Generation stopped with finishReason ${finishReason}`);
  }
}

// Saneado defensivo, aunque la salida sea estructurada: sin fences
// ```json/``` y solo lo que hay entre el primer "{" y el último "}".
function extractJson(text: string): string {
  const cleaned = cleanJsonResponse(text);
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end < start) throw new ParseError("No JSON object in the response");
  return cleaned.slice(start, end + 1);
}

// Exportada para probar los guardarraíles sin llamar al modelo.
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

// ------------------------------------------------------------
// Orquestador
// ------------------------------------------------------------

// Estado HTTP de un error de proveedor: ApiError de @google/genai o
// ProviderError de OpenRouter.
const statusOf = (error: unknown): number | null => {
  const status = (error as { status?: unknown })?.status;
  return typeof status === "number" ? status : null;
};

// Razón corta para la UI, según el último fallo.
function reasonFor(error: unknown, timedOut: boolean): string {
  if (timedOut) return `The prediction took longer than ${TIMEOUT_MS / 1000} seconds.`;
  if (error instanceof ParseError) return "The model's answer couldn't be read.";
  const status = statusOf(error);
  if (status === 429) return "The model's rate limit was reached. Try again in a minute.";
  if (status !== null && status >= 500) return "The model is overloaded right now.";
  return "The prediction service failed.";
}

export async function predictDetours(input: WorldModelInput): Promise<WorldModelOutcome> {
  // Se recorta otra vez aquí: la entrada viene del cliente.
  const pageContext = truncate(input.pageContext, PAGE_CONTEXT_MAX);
  // El objetivo lo escribió el usuario: instrucciones. La URL, el estado
  // capturado y la ruta medida vienen del sitio: page_data.
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
  let lastError: unknown = new Error("No provider is configured (GEMINI_API_KEY or OPENROUTER_*)");

  try {
    for (const provider of providerOrder()) {
      // Hasta PARSE_ATTEMPTS llamadas iguales si la respuesta no se puede
      // leer; un fallo del proveedor (red, 429, 5xx) pasa directo al
      // siguiente.
      for (let attempt = 1; attempt <= PARSE_ATTEMPTS; attempt++) {
        if (deadline.signal.aborted) break;
        const started = Date.now();
        const label = `${modelName(provider)} (attempt ${attempt}/${PARSE_ATTEMPTS})`;
        try {
          console.log(`[WorldModel] Predicting detours with ${label}...`);
          const answer = await ask(provider, request, deadline.signal);
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
          lastError = error;
          console.error(
            `[WorldModel] ${label} failed after ${Date.now() - started} ms:`,
            JSON.stringify({
              status: statusOf(error),
              parse: error instanceof ParseError,
              finishReason: error instanceof FinishError ? error.finishReason : undefined,
              timedOut: deadline.signal.aborted,
              message: (error as Error)?.message?.slice(0, 500),
            })
          );
          if (!(error instanceof ParseError)) break;
        }
      }
      if (deadline.signal.aborted) break;
    }
    return { ok: false, reason: reasonFor(lastError, deadline.signal.aborted) };
  } finally {
    clearTimeout(timer);
  }
}
