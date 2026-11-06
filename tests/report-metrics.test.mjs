// How friction reads on the report, and why the same analysis keeps the same prediction.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { frictionDisplay } from "../components/report/frictionDisplay.ts";
import { toTableRoute } from "../components/report/contract.ts";
import { routesFromComparison } from "../components/report/fromComparison.ts";
import { createPredictionCache, MAX_PREDICTIONS } from "../lib/worldmodel/world-model-cache.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const friction = (value, level = "medium") => ({ value, level });

describe("friction on the report", () => {
  test("a measured route shows the exact number", () => {
    assert.deepEqual(frictionDisplay({ friction: friction(42), status: "executed" }), {
      value: 42, level: "medium", text: "42", partial: false,
    });
  });

  test("zero on a finished route stays plain: it really was measured", () => {
    assert.equal(frictionDisplay({ friction: friction(0, "low"), status: "recommended" }).text, "0");
  });

  test("a world model scenario reads exactly like the agent: one number", () => {
    const row = toTableRoute({
      user: "Clicks Log in", subtitle: "UI confusion", probability: 30, steps: 3, friction: 45,
      status: "friction", reachedSteps: 3, recommendation: "x", stepNodes: [{ index: 1, label: "Click" }],
    });
    assert.deepEqual(frictionDisplay(row), frictionDisplay({ friction: row.friction, status: "executed" }));
    assert.equal(frictionDisplay(row).text, "45");
  });

  test("the bar has no estimated variant", () => {
    const bar = read("components/report/FrictionBar.tsx");
    assert.doesNotMatch(bar, /marginLeft/);
  });

  test("no friction value carries a tooltip: those belong to the badges", () => {
    assert.doesNotMatch(read("components/report/FrictionBar.tsx"), /Tooltip/);
    assert.doesNotMatch(read("components/report/frictionDisplay.ts"), /tip/i);
    assert.match(read("components/report/StatusBadge.tsx"), /<Tooltip/);
  });
});

describe("partial friction (continues)", () => {
  const partial = (value) => frictionDisplay({ friction: friction(value, "low"), status: "continues" });

  test("keeps the number and marks it as a floor", () => {
    assert.equal(partial(0).text, "0+");
    assert.equal(partial(30).text, "30+");
    assert.equal(partial(30).partial, true);
  });

  test("a route from the engine that continues elsewhere reads as partial", () => {
    const [row] = routesFromComparison({
      routes: [{ id: "r1", name: "Google", entryPoint: "Google", probability: 0.5, predictedFriction: 0.1, realFriction: 0,
        verified: true, outcome: "continues", continuation: "Continues in a popup", reachedGoal: false, stepResults: [] }],
      bestRouteId: null,
    });
    assert.equal(frictionDisplay(row).text, "0+");
  });
});

describe("stored world model predictions", () => {
  const input = {
    url: "https://linear.app",
    goal: "Sign up for an account",
    pageContext: "Title: Linear",
    happyPath: "Header Sign up link\n1. Clicks the Sign up link in the header",
  };
  const answer = (value) => ({
    ok: true, model: "m",
    scenarios: [{ user: "Clicks Log in", friction: value }],
  });

  test("the same page and goal get the first answer back", () => {
    const cache = createPredictionCache();
    cache.remember(input, answer(20));
    assert.equal(cache.get({ ...input }).scenarios[0].friction, 20);
  });

  test("the model rewording the same route doesn't count as a new analysis", () => {
    const cache = createPredictionCache();
    cache.remember(input, answer(20));
    const reworded = { ...input, happyPath: "Header sign up link\n1. Clicks the sign up link in the navigation bar" };
    assert.equal(cache.get(reworded).scenarios[0].friction, 20);
  });

  test("another goal, another site or a changed page is a new prediction", () => {
    const cache = createPredictionCache();
    cache.remember(input, answer(20));
    assert.equal(cache.get({ ...input, goal: "See pricing" }), null);
    assert.equal(cache.get({ ...input, url: "https://notion.com" }), null);
    assert.equal(cache.get({ ...input, pageContext: "Title: Linear, redesigned" }), null);
  });

  test("fields can't blend into each other to collide", () => {
    const cache = createPredictionCache();
    cache.remember({ ...input, url: "a", goal: "bc" }, answer(20));
    assert.equal(cache.get({ ...input, url: "ab", goal: "c" }), null);
  });

  test("a failure isn't stored, so Retry asks again", () => {
    const cache = createPredictionCache();
    cache.remember(input, { ok: false, reason: "The model is overloaded" });
    assert.equal(cache.get(input), null);
  });

  test("an empty answer isn't stored either", () => {
    const cache = createPredictionCache();
    cache.remember(input, { ok: true, scenarios: [], model: "m" });
    assert.equal(cache.get(input), null);
  });

  test("it can't grow forever: the oldest goes first", () => {
    const cache = createPredictionCache(2);
    for (const goal of ["a", "b", "c"]) cache.remember({ ...input, goal }, answer(20));
    assert.equal(cache.size, 2);
    assert.equal(cache.get({ ...input, goal: "a" }), null);
    assert.notEqual(cache.get({ ...input, goal: "c" }), null);
    assert.ok(MAX_PREDICTIONS >= 100);
  });

  test("the route looks before spending the limiter", () => {
    const route = read("app/api/world-model/route.ts");
    assert.ok(route.indexOf("predictions.get(") < route.indexOf("limiter.acquire()"));
    assert.ok(route.indexOf("predictDetours(validation") < route.indexOf("predictions.remember("));
  });
});

// gemini.ts needs the API key at import, so its callers are checked at the source: an unused import passes tsc.
describe("calls that friction depends on", () => {
  const calls = { "lib/worldmodel/world-model.ts": 1, "lib/worldmodel/route-dreamer.ts": 2, "lib/worldmodel/route-finder.ts": 1 };
  for (const [file, expected] of Object.entries(calls)) {
    test(`${file} doesn't sample`, () => {
      assert.equal(read(file).match(/temperature: NO_SAMPLING/g)?.length ?? 0, expected);
    });
  }

  test("the temperature reaches both providers", () => {
    assert.match(read("lib/llm/gemini.ts"), /temperature: request\.temperature/);
    assert.match(read("lib/worldmodel/world-model.ts"), /temperature: request\.temperature/);
  });
});
