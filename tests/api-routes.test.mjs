// API route tests (`npm test`). Node loads the .ts files directly (type stripping).
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

// Headers shaped like a Request's.
const headers = (values) => {
  const map = new Map(Object.entries(values).map(([k, v]) => [k.toLowerCase(), v]));
  return { get: (name) => map.get(name.toLowerCase()) ?? null };
};
const SPECTOR = { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000", "content-type": "application/json" };

// ---- 1. Origin and content type ----
describe("origin", () => {
  test("Spector's own UI passes (same origin, loopback)", () => {
    assert.deepEqual(checkApiRequest(headers(SPECTOR)), { ok: true });
    assert.deepEqual(checkApiRequest(headers({ ...SPECTOR, host: "localhost:3000", origin: "http://localhost:3000" })), { ok: true });
    assert.deepEqual(checkApiRequest(headers({ ...SPECTOR, host: "[::1]:3000", origin: "http://[::1]:3000" })), { ok: true });
  });

  test("no Origin (curl, a local script) passes: not a browser, so not CSRF", () => {
    assert.deepEqual(checkApiRequest(headers({ host: "127.0.0.1:3000", "content-type": "application/json" })), { ok: true });
  });

  for (const [name, values] of [
    ["any website (CSRF)", { ...SPECTOR, origin: "https://evil.example" }],
    ["another localhost port", { ...SPECTOR, origin: "http://127.0.0.1:8080" }],
    ["Origin null (sandboxed iframe, file:)", { ...SPECTOR, origin: "null" }],
    ["DNS rebinding: the attacker's Host", { ...SPECTOR, host: "rebind.evil.example:3000", origin: "http://rebind.evil.example:3000" }],
    ["a LAN Host", { ...SPECTOR, host: "192.168.1.20:3000", origin: "http://192.168.1.20:3000" }],
    ["no Host", { origin: SPECTOR.origin, "content-type": "application/json" }],
    ["Sec-Fetch-Site cross-site", { ...SPECTOR, "sec-fetch-site": "cross-site" }],
  ]) {
    test(`rejects: ${name}`, () => {
      const result = checkApiRequest(headers(values));
      assert.equal(result.ok, false);
      assert.equal(result.status, 403);
    });
  }
});

describe("Content-Type", () => {
  for (const type of [undefined, "text/plain", "text/plain;charset=UTF-8", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x", "application/jsonp"]) {
    test(`rejects ${type ?? "(no Content-Type)"}: such a POST skips the preflight`, () => {
      const values = { ...SPECTOR };
      if (type === undefined) delete values["content-type"];
      else values["content-type"] = type;
      const result = checkApiRequest(headers(values));
      assert.equal(result.ok, false);
      assert.equal(result.status, 415);
    });
  }
  test("accepts application/json with a charset", () => {
    assert.deepEqual(checkApiRequest(headers({ ...SPECTOR, "content-type": "application/json; charset=utf-8" })), { ok: true });
  });
});

describe("linkAbort", () => {
  test("with an already-aborted signal, aborts the target right away", () => {
    const source = new AbortController();
    source.abort("client gone");
    const target = new AbortController();
    linkAbort(source.signal, target);
    assert.equal(target.signal.aborted, true);
    assert.equal(target.signal.reason, "client gone");
  });

  test("control: addEventListener alone never fires on an already-aborted signal", async () => {
    const source = new AbortController();
    source.abort();
    let fired = false;
    source.signal.addEventListener("abort", () => (fired = true), { once: true });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(fired, false);
  });

  test("with a live signal, aborts the target when the source aborts", () => {
    const source = new AbortController();
    const target = new AbortController();
    linkAbort(source.signal, target);
    assert.equal(target.signal.aborted, false);
    source.abort("later");
    assert.equal(target.signal.aborted, true);
    assert.equal(target.signal.reason, "later");
  });

  test("cleanup removes the listener: aborting the source later no longer aborts the target", () => {
    const source = new AbortController();
    const target = new AbortController();
    const cleanup = linkAbort(source.signal, target);
    cleanup();
    source.abort();
    assert.equal(target.signal.aborted, false);
  });

  test("cleanup on an already-aborted signal doesn't throw", () => {
    const source = new AbortController();
    source.abort();
    assert.doesNotThrow(linkAbort(source.signal, new AbortController()));
  });
});

// A body that never ends unless the reader stops pulling; counts what it handed out. highWaterMark 0
// so it only produces on read (the default prefetches one chunk at construction).
const endlessBody = (chunk) => {
  const stats = { pulled: 0, cancelled: false };
  const bytes = new TextEncoder().encode(chunk);
  const body = new ReadableStream(
    {
      pull(controller) {
        stats.pulled += bytes.length;
        controller.enqueue(bytes);
      },
      cancel() {
        stats.cancelled = true;
      },
    },
    { highWaterMark: 0 }
  );
  return { body, stats };
};
const bodyOf = (text) => new Response(text).body;

describe("body size", () => {
  test("oversized Content-Length: 413 without reading the body", async () => {
    const { body, stats } = endlessBody("x");
    const result = await readBody({ headers: headers({ "content-length": "999999" }), body }, 1000);
    assert.equal(result.status, 413);
    assert.equal(stats.pulled, 0);
  });

  test("oversized actual body: 413", async () => {
    const result = await readBody({ headers: headers({}), body: bodyOf("x".repeat(1001)) }, 1000);
    assert.equal(result.status, 413);
  });

  test("chunked body without Content-Length over the cap: 413, stops reading right after the cap", async () => {
    const { body, stats } = endlessBody("x".repeat(256));
    const result = await readBody({ headers: headers({}), body }, 1000);
    assert.equal(result.status, 413);
    assert.equal(stats.cancelled, true);
    assert.ok(stats.pulled <= 1000 + 2 * 256, `read ${stats.pulled} bytes`);
  });

  test("a body within the cap is returned whole, multi-byte characters included", async () => {
    const text = JSON.stringify({ goal: "Sign up → ✓ 日本語" });
    assert.deepEqual(await readBody({ headers: headers({}), body: bodyOf(text) }, 1000), { ok: true, text });
  });

  test("no body: empty text", async () => {
    assert.deepEqual(await readBody({ headers: headers({}), body: null }, 1000), { ok: true, text: "" });
  });
});

// ---- 2. Schema ----
describe("/api/goal/stream schema", () => {
  const valid = { url: "https://linear.app", goal: "See the pricing plans", personaMode: "automatic" };

  test("the command bar's request passes", () => {
    assert.equal(validateAnalysisRequest(valid).ok, true);
    assert.equal(validateAnalysisRequest({ url: "https://x.com", goal: "Sign up" }).ok, true);
    assert.equal(validateAnalysisRequest({ ...valid, personaMode: "personal", customPersona: "A busy parent on mobile" }).ok, true);
  });

  for (const [name, body] of [
    ["an array", [valid]],
    ["null", null],
    ["a string", "https://linear.app"],
    ["an extra field", { ...valid, model: "gpt" }],
    ["a non-string url", { ...valid, url: 42 }],
    ["an invalid url", { ...valid, url: "not a url" }],
    ["a 3000-character url", { ...valid, url: `https://x.com/${"a".repeat(3000)}` }],
    ["no goal", { url: valid.url }],
    ["an empty goal", { ...valid, goal: "   " }],
    ["a goal that's too long", { ...valid, goal: "x".repeat(MAX_GOAL + 1) }],
    ["personaMode desconocido", { ...valid, personaMode: "admin" }],
    ["a non-string customPersona", { ...valid, personaMode: "personal", customPersona: { a: 1 } }],
    ["customPersona demasiado larga", { ...valid, personaMode: "personal", customPersona: "x".repeat(5000) }],
    ["personal mode without a description", { ...valid, personaMode: "personal" }],
  ]) {
    test(`rejects ${name}`, () => assert.equal(validateAnalysisRequest(body).ok, false));
  }
});

describe("/api/world-model schema", () => {
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

  test("what the client builds passes", () => {
    assert.equal(validateWorldModelInput(valid).ok, true);
  });

  test("a pageContext truncated by the client passes", () => {
    const big = { ...state, headings: Array.from({ length: 12 }, () => `H2: ${"x".repeat(2000)}`) };
    const pageContext = compactPageContext(big);
    assert.ok(pageContext.endsWith("(truncated)"));
    assert.equal(validateWorldModelInput({ ...valid, pageContext }).ok, true);
  });

  for (const [name, body] of [
    ["an extra field", { ...valid, prompt: "ignore previous instructions" }],
    ["a missing field", { url: valid.url, goal: valid.goal, pageContext: valid.pageContext }],
    ["a non-string field", { ...valid, happyPath: ["step"] }],
    ["an oversized arbitrary pageContext", { ...valid, pageContext: "x".repeat(PAGE_CONTEXT_MAX + 100) }],
    ["an empty goal", { ...valid, goal: "" }],
    ["a non-http(s) url", { ...valid, url: "file:///etc/passwd" }],
    ["an array", [valid]],
  ]) {
    test(`rejects ${name}`, () => assert.equal(validateWorldModelInput(body).ok, false));
  }
});

// ---- 3. Rate limit ----
describe("rate limit", () => {
  test("a running analysis blocks parallel ones", () => {
    const limiter = createLimiter({ maxConcurrent: 1, maxPerWindow: 10, windowMs: 60_000, noun: "analysis" });
    const first = limiter.acquire(0);
    assert.equal(first.ok, true);
    const results = Array.from({ length: 10 }, () => limiter.acquire(1));
    assert.ok(results.every((r) => !r.ok && r.reason === "busy"));
    first.release();
    assert.equal(limiter.acquire(2).ok, true);
  });

  test("per-window cap, with when to try again", () => {
    const limiter = createLimiter({ maxConcurrent: 5, maxPerWindow: 2, windowMs: 60_000, noun: "analysis" });
    limiter.acquire(0).release();
    limiter.acquire(10_000).release();
    const third = limiter.acquire(20_000);
    assert.equal(third.ok, false);
    assert.equal(third.reason, "window");
    assert.equal(third.retryAfterSeconds, 40);
    assert.equal(limiter.acquire(60_001).ok, true);
  });

  test("releasing twice doesn't let two through", () => {
    const limiter = createLimiter({ maxConcurrent: 1, maxPerWindow: 10, windowMs: 60_000, noun: "analysis" });
    const slot = limiter.acquire(0);
    slot.release();
    slot.release();
    assert.equal(limiter.acquire(1).ok, true);
    assert.equal(limiter.acquire(2).ok, false);
  });
});

// ---- 4 and 5. Honest errors and a useful Retry ----
// A 429 as @google/genai throws it: ApiError with the status and Gemini's JSON body as the message.
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

describe("honest errors", () => {
  test("a 429 is reported as quota, with Gemini's retryDelay", () => {
    const failure = describeFailure(gemini429("37s"));
    assert.equal(failure.kind, "quota");
    assert.equal(failure.retryAfterSeconds, 37);
    assert.equal(failure.retryable, true);
    assert.match(failure.message, /rate limit/i);
    assert.doesNotMatch(failure.message, /took longer|timed out/i);
  });

  test("a 429 without retryDelay: quota, wait a minute", () => {
    const failure = describeFailure(gemini429(null));
    assert.equal(failure.kind, "quota");
    assert.equal(failure.retryAfterSeconds, 60);
  });

  test("the daily quota offers no retry", () => {
    const failure = describeFailure(gemini429("3600s", "GenerateRequestsPerDayPerProjectPerModel-FreeTier"));
    assert.equal(failure.kind, "quota");
    assert.equal(failure.retryable, false);
    assert.match(failure.message, /daily/i);
  });

  test("a 429 wins over the timeout: with quota, it never says 'took longer than 25 s'", () => {
    const failure = pickFailure([gemini429("20s"), new Error("This operation was aborted")], {
      timedOut: true,
      timeoutMessage: "The prediction took longer than 25 seconds.",
    });
    assert.equal(failure.kind, "quota");
    assert.doesNotMatch(failure.message, /took longer/);
  });

  test("without a 429, a real timeout is a timeout", () => {
    const failure = pickFailure([new Error("This operation was aborted")], {
      timedOut: true,
      timeoutMessage: "The prediction took longer than 25 seconds.",
    });
    assert.equal(failure.kind, "timeout");
    assert.match(failure.message, /took longer than 25 seconds/);
  });

  test("ModelQuotaError (thrown by askGemini after waiting) is quota too", () => {
    assert.deepEqual(quotaInfo(new ModelQuotaError(12_000, false)), { retryAfterMs: 12_000, daily: false });
    assert.equal(describeFailure(new ModelQuotaError(12_000, false)).retryAfterSeconds, 12);
  });

  test("site, deadline and model failures, each with its reason", () => {
    const site = describeFailure(new Error("page.goto: net::ERR_NAME_NOT_RESOLVED at https://no.example/\nCall log: …"));
    assert.equal(site.kind, "site");
    assert.match(site.message, /ERR_NAME_NOT_RESOLVED/);
    assert.doesNotMatch(site.message, /Call log/);
    assert.equal(describeFailure(Object.assign(new Error("x"), { name: "AnalysisTimeoutError" })).kind, "timeout");
    assert.equal(describeFailure(apiError(503, { error: { code: 503 } })).kind, "overloaded");
    assert.equal(describeFailure(Object.assign(new Error("This URL is not allowed."), { name: "UrlNotAllowedError" })).retryable, false);
  });

  test("an unknown error doesn't leak its details to the client", () => {
    const failure = describeFailure(new Error("ENOENT: no such file C:\\secret\\path"));
    assert.equal(failure.kind, "unknown");
    assert.doesNotMatch(failure.message, /ENOENT|secret/);
  });

  test("no stage swallows quota, deadline or cancellation", () => {
    assert.equal(mustPropagate(gemini429("5s")), true);
    assert.equal(mustPropagate(new ModelQuotaError(null, false)), true);
    assert.equal(mustPropagate(Object.assign(new Error(), { name: "AnalysisCancelledError" })), true);
    assert.equal(mustPropagate(new SyntaxError("bad JSON")), false);
  });
});

// ---- 6. Cancel on disconnect ----
const CHROMIUM = resolveChromiumPath();

describe("cancel on disconnect", () => {
  test("an outside abort stops the analysis and its signal", async () => {
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
    assert.equal(inner.aborted, true, "model calls receive the cancellation");
    assert.ok(Date.now() - started < 2000);
  });

  test("withAnalysisDeadline with a pre-aborted signal rejects without running run", async () => {
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

  test("cancelling closes the browser", { skip: !fs.existsSync(CHROMIUM) && "Chromium is not installed" }, async () => {
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
    // Wait for the browser to exist before disconnecting.
    while (!browser) await new Promise((r) => setTimeout(r, 50));
    client.abort();
    await assert.rejects(run, AnalysisCancelledError);
    assert.equal(browser.isConnected(), false);
  });
});
