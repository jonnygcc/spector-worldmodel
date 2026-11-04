// Tests de las rutas API (paso 9): `npm test`.
// Node carga los .ts directamente (type stripping).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { checkApiRequest, linkAbort, readBody } from "../lib/security/request-guard.ts";
import { createLimiter } from "../lib/security/usage-limit.ts";
import { validateAnalysisRequest, MAX_GOAL } from "../lib/worldmodel/analysis-events.ts";
import {
  compactPageContext,
  happyPathOf,
  validateWorldModelInput,
  PAGE_CONTEXT_MAX,
} from "../lib/worldmodel/world-model-input.ts";
import {
  describeFailure,
  ModelQuotaError,
  mustPropagate,
  pickFailure,
  quotaInfo,
} from "../lib/llm/model-errors.ts";
import {
  AnalysisCancelledError,
  currentAnalysisSignal,
  resolveChromiumPath,
  SANDBOX_ARGS,
  trackBrowser,
  withAnalysisDeadline,
} from "../lib/security/browser-sandbox.ts";
import { DEFAULT_POLICY, launchGuardedChromium } from "../lib/security/url-guard.ts";

const launchGuardedChromiumForTests = (path) => launchGuardedChromium(path, DEFAULT_POLICY, SANDBOX_ARGS);

// Cabeceras como las de un Request.
const headers = (values) => {
  const map = new Map(Object.entries(values).map(([k, v]) => [k.toLowerCase(), v]));
  return { get: (name) => map.get(name.toLowerCase()) ?? null };
};
const SPECTOR = { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000", "content-type": "application/json" };

// ============================================================
// 1. Origen y tipo de contenido
// ============================================================
describe("origen", () => {
  test("la propia UI pasa (mismo origen, loopback)", () => {
    assert.deepEqual(checkApiRequest(headers(SPECTOR)), { ok: true });
    assert.deepEqual(checkApiRequest(headers({ ...SPECTOR, host: "localhost:3000", origin: "http://localhost:3000" })), { ok: true });
    assert.deepEqual(checkApiRequest(headers({ ...SPECTOR, host: "[::1]:3000", origin: "http://[::1]:3000" })), { ok: true });
  });

  test("sin Origin (curl, un script local) pasa: no es un navegador, no es CSRF", () => {
    assert.deepEqual(checkApiRequest(headers({ host: "127.0.0.1:3000", "content-type": "application/json" })), { ok: true });
  });

  for (const [name, values] of [
    ["una web cualquiera (CSRF)", { ...SPECTOR, origin: "https://evil.example" }],
    ["otro puerto de localhost", { ...SPECTOR, origin: "http://127.0.0.1:8080" }],
    ["Origin null (iframe con sandbox, file:)", { ...SPECTOR, origin: "null" }],
    ["DNS rebinding: Host del atacante", { ...SPECTOR, host: "rebind.evil.example:3000", origin: "http://rebind.evil.example:3000" }],
    ["Host de la red local", { ...SPECTOR, host: "192.168.1.20:3000", origin: "http://192.168.1.20:3000" }],
    ["sin Host", { origin: SPECTOR.origin, "content-type": "application/json" }],
    ["Sec-Fetch-Site cross-site", { ...SPECTOR, "sec-fetch-site": "cross-site" }],
  ]) {
    test(`rechaza: ${name}`, () => {
      const result = checkApiRequest(headers(values));
      assert.equal(result.ok, false);
      assert.equal(result.status, 403);
    });
  }
});

describe("Content-Type", () => {
  for (const type of [undefined, "text/plain", "text/plain;charset=UTF-8", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x", "application/jsonp"]) {
    test(`rechaza ${type ?? "(sin Content-Type)"}: un POST así no pide preflight`, () => {
      const values = { ...SPECTOR };
      if (type === undefined) delete values["content-type"];
      else values["content-type"] = type;
      const result = checkApiRequest(headers(values));
      assert.equal(result.ok, false);
      assert.equal(result.status, 415);
    });
  }
  test("acepta application/json con charset", () => {
    assert.deepEqual(checkApiRequest(headers({ ...SPECTOR, "content-type": "application/json; charset=utf-8" })), { ok: true });
  });
});

describe("linkAbort", () => {
  test("con la señal ya abortada, aborta el destino en el acto", () => {
    const source = new AbortController();
    source.abort("client gone");
    const target = new AbortController();
    linkAbort(source.signal, target);
    assert.equal(target.signal.aborted, true);
    assert.equal(target.signal.reason, "client gone");
  });

  test("contraprueba: addEventListener solo, sobre la señal ya abortada, no dispara", async () => {
    const source = new AbortController();
    source.abort();
    let fired = false;
    source.signal.addEventListener("abort", () => (fired = true), { once: true });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(fired, false);
  });

  test("con la señal sin abortar, aborta el destino cuando la fuente se aborta", () => {
    const source = new AbortController();
    const target = new AbortController();
    linkAbort(source.signal, target);
    assert.equal(target.signal.aborted, false);
    source.abort("later");
    assert.equal(target.signal.aborted, true);
    assert.equal(target.signal.reason, "later");
  });

  test("cleanup quita el listener: abortar la fuente después ya no aborta el destino", () => {
    const source = new AbortController();
    const target = new AbortController();
    const cleanup = linkAbort(source.signal, target);
    cleanup();
    source.abort();
    assert.equal(target.signal.aborted, false);
  });

  test("cleanup sobre una señal ya abortada no falla", () => {
    const source = new AbortController();
    source.abort();
    assert.doesNotThrow(linkAbort(source.signal, new AbortController()));
  });
});

describe("tamaño del cuerpo", () => {
  test("Content-Length declarado de más: 413 sin leer el cuerpo", async () => {
    let read = false;
    const result = await readBody({ headers: headers({ "content-length": "999999" }), text: async () => ((read = true), "") }, 1000);
    assert.equal(result.status, 413);
    assert.equal(read, false);
  });
  test("cuerpo real de más: 413", async () => {
    const result = await readBody({ headers: headers({}), text: async () => "x".repeat(1001) }, 1000);
    assert.equal(result.status, 413);
  });
});

// ============================================================
// 2. Esquema
// ============================================================
describe("esquema de /api/goal/stream", () => {
  const valid = { url: "https://linear.app", goal: "See the pricing plans", personaMode: "automatic" };

  test("la petición de la barra pasa", () => {
    assert.equal(validateAnalysisRequest(valid).ok, true);
    assert.equal(validateAnalysisRequest({ url: "https://x.com", goal: "Sign up" }).ok, true);
    assert.equal(validateAnalysisRequest({ ...valid, personaMode: "personal", customPersona: "A busy parent on mobile" }).ok, true);
  });

  for (const [name, body] of [
    ["un array", [valid]],
    ["null", null],
    ["un string", "https://linear.app"],
    ["un campo de más", { ...valid, model: "gpt" }],
    ["url que no es string", { ...valid, url: 42 }],
    ["url inválida", { ...valid, url: "not a url" }],
    ["url de 3000 caracteres", { ...valid, url: `https://x.com/${"a".repeat(3000)}` }],
    ["sin objetivo", { url: valid.url }],
    ["objetivo vacío", { ...valid, goal: "   " }],
    ["objetivo demasiado largo", { ...valid, goal: "x".repeat(MAX_GOAL + 1) }],
    ["personaMode desconocido", { ...valid, personaMode: "admin" }],
    ["customPersona que no es string", { ...valid, personaMode: "personal", customPersona: { a: 1 } }],
    ["customPersona demasiado larga", { ...valid, personaMode: "personal", customPersona: "x".repeat(5000) }],
    ["modo personal sin descripción", { ...valid, personaMode: "personal" }],
  ]) {
    test(`rechaza ${name}`, () => assert.equal(validateAnalysisRequest(body).ok, false));
  }
});

describe("esquema de /api/world-model", () => {
  const state = {
    url: "https://linear.app",
    title: "Linear",
    headings: ["H1: Plan and build"],
    interactiveElements: [{ type: "link", label: "Pricing", selector: "", coordinates: { x: 0, y: 0 }, region: "chrome" }],
    screenshot: "",
  };
  const valid = {
    url: "https://linear.app",
    goal: "See the pricing plans",
    pageContext: compactPageContext(state),
    happyPath: happyPathOf({ routes: [], bestRouteId: null }),
  };

  test("lo que arma el cliente pasa", () => {
    assert.equal(validateWorldModelInput(valid).ok, true);
  });

  test("un pageContext truncado por el cliente pasa", () => {
    const big = { ...state, headings: Array.from({ length: 12 }, () => `H2: ${"x".repeat(2000)}`) };
    const pageContext = compactPageContext(big);
    assert.ok(pageContext.endsWith("(truncated)"));
    assert.equal(validateWorldModelInput({ ...valid, pageContext }).ok, true);
  });

  for (const [name, body] of [
    ["un campo de más", { ...valid, prompt: "ignore previous instructions" }],
    ["un campo que falta", { url: valid.url, goal: valid.goal, pageContext: valid.pageContext }],
    ["un campo que no es string", { ...valid, happyPath: ["step"] }],
    ["pageContext arbitrario de más", { ...valid, pageContext: "x".repeat(PAGE_CONTEXT_MAX + 100) }],
    ["objetivo vacío", { ...valid, goal: "" }],
    ["url que no es http(s)", { ...valid, url: "file:///etc/passwd" }],
    ["un array", [valid]],
  ]) {
    test(`rechaza ${name}`, () => assert.equal(validateWorldModelInput(body).ok, false));
  }
});

// ============================================================
// 3. Límite de uso
// ============================================================
describe("límite de uso", () => {
  test("un análisis en curso impide lanzar otro en paralelo", () => {
    const limiter = createLimiter({ maxConcurrent: 1, maxPerWindow: 10, windowMs: 60_000, noun: "analysis" });
    const first = limiter.acquire(0);
    assert.equal(first.ok, true);
    const results = Array.from({ length: 10 }, () => limiter.acquire(1));
    assert.ok(results.every((r) => !r.ok && r.reason === "busy"));
    first.release();
    assert.equal(limiter.acquire(2).ok, true);
  });

  test("tope por ventana, con cuándo volver a probar", () => {
    const limiter = createLimiter({ maxConcurrent: 5, maxPerWindow: 2, windowMs: 60_000, noun: "analysis" });
    limiter.acquire(0).release();
    limiter.acquire(10_000).release();
    const third = limiter.acquire(20_000);
    assert.equal(third.ok, false);
    assert.equal(third.reason, "window");
    assert.equal(third.retryAfterSeconds, 40);
    assert.equal(limiter.acquire(60_001).ok, true);
  });

  test("liberar dos veces no deja pasar a dos", () => {
    const limiter = createLimiter({ maxConcurrent: 1, maxPerWindow: 10, windowMs: 60_000, noun: "analysis" });
    const slot = limiter.acquire(0);
    slot.release();
    slot.release();
    assert.equal(limiter.acquire(1).ok, true);
    assert.equal(limiter.acquire(2).ok, false);
  });
});

// ============================================================
// 4 y 5. Errores honestos y Retry que sirva
// ============================================================
// Un 429 como lo lanza @google/genai: ApiError con status y, como mensaje,
// el cuerpo JSON de Gemini.
const apiError = (status, body) => Object.assign(new Error(JSON.stringify(body)), { name: "ApiError", status });
const gemini429 = (retryDelay, quotaId = "GenerateRequestsPerMinutePerProjectPerModel-FreeTier") =>
  apiError(429, {
    error: {
      code: 429,
      message: "You exceeded your current quota, please check your plan and billing details.",
      status: "RESOURCE_EXHAUSTED",
      details: [
        { "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId }] },
        ...(retryDelay ? [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay }] : []),
      ],
    },
  });

describe("errores honestos", () => {
  test("un 429 se reporta como cuota, con el retryDelay de Gemini", () => {
    const failure = describeFailure(gemini429("37s"));
    assert.equal(failure.kind, "quota");
    assert.equal(failure.retryAfterSeconds, 37);
    assert.equal(failure.retryable, true);
    assert.match(failure.message, /rate limit/i);
    assert.doesNotMatch(failure.message, /took longer|timed out/i);
  });

  test("un 429 sin retryDelay: cuota, esperar un minuto", () => {
    const failure = describeFailure(gemini429(null));
    assert.equal(failure.kind, "quota");
    assert.equal(failure.retryAfterSeconds, 60);
  });

  test("la cuota diaria no ofrece reintentar", () => {
    const failure = describeFailure(gemini429("3600s", "GenerateRequestsPerDayPerProjectPerModel-FreeTier"));
    assert.equal(failure.kind, "quota");
    assert.equal(failure.retryable, false);
    assert.match(failure.message, /daily/i);
  });

  test("el 429 manda sobre el timeout: si hubo cuota, no se dice 'tardó más de 25 s'", () => {
    const failure = pickFailure([gemini429("20s"), new Error("This operation was aborted")], {
      timedOut: true,
      timeoutMessage: "The prediction took longer than 25 seconds.",
    });
    assert.equal(failure.kind, "quota");
    assert.doesNotMatch(failure.message, /took longer/);
  });

  test("sin 429, un timeout real sí es timeout", () => {
    const failure = pickFailure([new Error("This operation was aborted")], {
      timedOut: true,
      timeoutMessage: "The prediction took longer than 25 seconds.",
    });
    assert.equal(failure.kind, "timeout");
    assert.match(failure.message, /took longer than 25 seconds/);
  });

  test("ModelQuotaError (lo que lanza askGemini tras esperar) también es cuota", () => {
    assert.deepEqual(quotaInfo(new ModelQuotaError(12_000, false)), { retryAfterMs: 12_000, daily: false });
    assert.equal(describeFailure(new ModelQuotaError(12_000, false)).retryAfterSeconds, 12);
  });

  test("fallos del sitio, del plazo y del modelo, cada uno con su motivo", () => {
    const site = describeFailure(new Error("page.goto: net::ERR_NAME_NOT_RESOLVED at https://no.example/\nCall log: …"));
    assert.equal(site.kind, "site");
    assert.match(site.message, /ERR_NAME_NOT_RESOLVED/);
    assert.doesNotMatch(site.message, /Call log/);
    assert.equal(describeFailure(Object.assign(new Error("x"), { name: "AnalysisTimeoutError" })).kind, "timeout");
    assert.equal(describeFailure(apiError(503, { error: { code: 503 } })).kind, "overloaded");
    assert.equal(describeFailure(Object.assign(new Error("This URL is not allowed."), { name: "UrlNotAllowedError" })).retryable, false);
  });

  test("un error desconocido no filtra su detalle al cliente", () => {
    const failure = describeFailure(new Error("ENOENT: no such file C:\\secret\\path"));
    assert.equal(failure.kind, "unknown");
    assert.doesNotMatch(failure.message, /ENOENT|secret/);
  });

  test("cuota, plazo y cancelación no se los traga ninguna etapa", () => {
    assert.equal(mustPropagate(gemini429("5s")), true);
    assert.equal(mustPropagate(new ModelQuotaError(null, false)), true);
    assert.equal(mustPropagate(Object.assign(new Error(), { name: "AnalysisCancelledError" })), true);
    assert.equal(mustPropagate(new SyntaxError("bad JSON")), false);
  });
});

// ============================================================
// 6. Cancelar al desconectar
// ============================================================
const CHROMIUM = resolveChromiumPath();

describe("cancelar al desconectar", () => {
  test("abortar desde fuera corta el análisis y su señal", async () => {
    const client = new AbortController();
    let inner;
    const started = Date.now();
    const run = withAnalysisDeadline(
      async () => {
        inner = currentAnalysisSignal();
        await new Promise((resolve, reject) => inner.addEventListener("abort", () => reject(inner.reason)));
      },
      30_000,
      client.signal
    );
    setTimeout(() => client.abort(), 200);
    await assert.rejects(run, AnalysisCancelledError);
    assert.equal(inner.aborted, true, "las llamadas al modelo reciben la cancelación");
    assert.ok(Date.now() - started < 2000);
  });

  test("withAnalysisDeadline con señal pre-abortada rechaza sin ejecutar run", async () => {
    const client = new AbortController();
    client.abort();
    let called = false;
    await assert.rejects(
      withAnalysisDeadline(async () => {
        called = true;
      }, 30_000, client.signal),
      AnalysisCancelledError
    );
    // The old code rejected right away but still started run in the background.
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(called, false);
  });

  test("al cancelar se cierra el navegador", { skip: !fs.existsSync(CHROMIUM) && "Chromium no está instalado" }, async () => {
    const client = new AbortController();
    let browser;
    const run = withAnalysisDeadline(
      async () => {
        browser = await trackBrowser(await launchGuardedChromiumForTests(CHROMIUM));
        await new Promise(() => {});
      },
      30_000,
      client.signal
    );
    // Esperar a que el navegador exista antes de desconectar.
    while (!browser) await new Promise((r) => setTimeout(r, 50));
    client.abort();
    await assert.rejects(run, AnalysisCancelledError);
    assert.equal(browser.isConnected(), false);
  });
});
