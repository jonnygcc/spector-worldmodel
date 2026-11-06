// How each kind of friction reads: measured, estimated and partial must not look alike.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ESTIMATE_MARGIN, ESTIMATED_TIP, frictionDisplay, PARTIAL_TIP } from "../components/report/frictionDisplay.ts";
import { toTableRoute } from "../components/report/contract.ts";
import { routesFromComparison } from "../components/report/fromComparison.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const friction = (value, level = "medium") => ({ value, level });

describe("measured friction", () => {
  test("is the exact number, with a solid bar and no tooltip", () => {
    assert.deepEqual(frictionDisplay({ friction: friction(42), status: "executed" }), {
      kind: "measured", level: "medium", text: "42", start: 0, width: 42,
    });
  });

  test("zero on a finished route stays plain: it really was measured", () => {
    assert.equal(frictionDisplay({ friction: friction(0, "low"), status: "recommended" }).text, "0");
  });
});

describe("estimated friction (world model)", () => {
  const estimate = (value) => frictionDisplay({ friction: friction(value), estimated: true, status: "friction" });

  test("is a range, never the exact integer", () => {
    const shown = estimate(45);
    assert.equal(shown.kind, "estimated");
    assert.equal(shown.text, "20–70");
    assert.notEqual(shown.text, "45");
  });

  test("the bar covers the range, not the value", () => {
    const { start, width } = estimate(45);
    assert.deepEqual({ start, width }, { start: 20, width: 50 });
  });

  test("the center rounds to 5, so a 43 doesn't claim more than a 45", () => {
    assert.equal(estimate(43).text, estimate(45).text);
  });

  test("stays within 0–100 at both ends", () => {
    assert.equal(estimate(10).text, "0–35");
    assert.equal(estimate(90).text, "65–100");
    assert.equal(estimate(0).text, "0–25");
    assert.equal(estimate(100).text, "75–100");
  });

  test("the range covers what the same analysis gave across runs", () => {
    const mean = (35 + 45 + 65) / 3;
    for (const run of [35, 45, 65]) {
      const { start, width } = estimate(run);
      assert.ok(mean >= start && mean <= start + width, `${run}: ${estimate(run).text}`);
    }
    assert.equal(ESTIMATE_MARGIN, 25);
  });

  test("explains itself", () => assert.equal(estimate(45).tip, ESTIMATED_TIP));

  test("a table row built from a scenario reads as an estimate", () => {
    const row = toTableRoute({
      user: "Clicks Log in", subtitle: "UI confusion", probability: 30, steps: 3, friction: 45,
      status: "friction", reachedSteps: 3, recommendation: "x", stepNodes: [{ index: 1, label: "Click" }],
    });
    assert.equal(frictionDisplay(row).text, "20–70");
  });

  test("the scenario order isn't touched by the display", () => {
    const rows = [65, 10, 80].map((value) => frictionDisplay({ friction: friction(value), estimated: true }).text);
    assert.deepEqual(rows, ["40–90", "0–35", "55–100"]);
  });
});

describe("partial friction (continues)", () => {
  const partial = (value) => frictionDisplay({ friction: friction(value, "low"), status: "continues" });

  test("keeps the number and marks it as a floor", () => {
    assert.equal(partial(0).text, "0+");
    assert.equal(partial(30).text, "30+");
  });

  test("the bar still shows the measured part only", () => {
    const { start, width, kind } = partial(30);
    assert.deepEqual({ start, width, kind }, { start: 0, width: 30, kind: "partial" });
  });

  test("explains itself", () => assert.equal(partial(0).tip, PARTIAL_TIP));

  test("a route from the engine that continues elsewhere reads as partial", () => {
    const [row] = routesFromComparison({
      routes: [{ id: "r1", name: "Google", entryPoint: "Google", probability: 0.5, predictedFriction: 0.1, realFriction: 0,
        verified: true, outcome: "continues", continuation: "Continues in a popup", reachedGoal: false, stepResults: [] }],
      bestRouteId: null,
    });
    assert.equal(frictionDisplay(row).text, "0+");
  });
});

describe("the three kinds never look the same", () => {
  test("same value, three different readings", () => {
    const value = friction(30);
    const texts = [
      frictionDisplay({ friction: value, status: "executed" }).text,
      frictionDisplay({ friction: value, estimated: true, status: "friction" }).text,
      frictionDisplay({ friction: value, status: "continues" }).text,
    ];
    assert.equal(new Set(texts).size, 3, texts.join(" "));
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
