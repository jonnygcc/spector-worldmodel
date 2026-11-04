// Browser-vs-hostile-page tests (`npm test`). Node loads the .ts files directly (type stripping).
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { chromium } from "playwright-core";
import { gotoAllowed, launchGuardedChromium } from "../lib/security/url-guard.ts";
import {
  AnalysisTimeoutError,
  BROWSER_CLOSE_TIMEOUT_MS,
  evaluateWithTimeout,
  MAX_NAVIGATIONS_PER_PAGE,
  newSandboxedPage,
  resolveChromiumPath,
  SANDBOX_ARGS,
  trackBrowser,
  withAnalysisDeadline,
} from "../lib/security/browser-sandbox.ts";

const ROOT = path.resolve(import.meta.dirname, "..");

// ---- Chromium path ----
describe("Chromium path", () => {
  test("without the variable, playwright-core's", () => {
    const saved = process.env.SPECTOR_CHROMIUM_PATH;
    delete process.env.SPECTOR_CHROMIUM_PATH;
    try {
      assert.equal(resolveChromiumPath(), chromium.executablePath());
    } finally {
      if (saved !== undefined) process.env.SPECTOR_CHROMIUM_PATH = saved;
    }
  });

  test("SPECTOR_CHROMIUM_PATH wins", () => {
    const saved = process.env.SPECTOR_CHROMIUM_PATH;
    process.env.SPECTOR_CHROMIUM_PATH = "/opt/chromium/chrome";
    try {
      assert.equal(resolveChromiumPath(), "/opt/chromium/chrome");
    } finally {
      if (saved === undefined) delete process.env.SPECTOR_CHROMIUM_PATH;
      else process.env.SPECTOR_CHROMIUM_PATH = saved;
    }
  });

  test("no Windows user path in the code or the tests", () => {
    const files = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|tsx|mjs|js)$/.test(entry.name)) files.push(full);
      }
    };
    for (const dir of ["app", "components", "lib", "tests"]) walk(path.join(ROOT, dir));
    const offenders = files.filter((file) => /[A-Za-z]:[\\/]+Users[\\/]/.test(fs.readFileSync(file, "utf8")));
    assert.deepEqual(offenders.map((f) => path.relative(ROOT, f)), []);
  });
});

// ---- Real browser ----
const CHROMIUM = resolveChromiumPath();

// Chromium processes whose command line carries the test's marker.
function chromiumProcessesWith(marker) {
  const out =
    process.platform === "win32"
      ? execFileSync(
          "powershell",
          ["-NoProfile", "-Command", "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | ForEach-Object { $_.CommandLine }"],
          { encoding: "utf8" }
        )
      : execFileSync("ps", ["-axo", "args"], { encoding: "utf8" });
  return out.split(/\r?\n/).filter((line) => line.includes(marker)).length;
}

async function waitFor(check, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return check();
}

describe("browser", { skip: !fs.existsSync(CHROMIUM) && "Chromium is not installed" }, () => {
  let server, port, policy, browser;
  const marker = `--spector-test-run=${randomUUID()}`;

  before(async () => {
    const pages = {
      "/ok": "<h1>OK</h1>",
      "/download": null,
      "/download-page": `<a id="d" href="/download">file</a>`,
      "/popup": `<h1>POPUP-PAGE</h1><script>window.open('/ok'); window.open('/ok', '_blank');</script>`,
      "/dialogs": `<script>alert('a'); window.__confirm = confirm('b'); window.__prompt = prompt('c'); document.title = 'after-dialogs';</script>`,
      "/loop": `<script>setTimeout(() => { location.href = '/loop?' + Date.now(); }, 20);</script>`,
      "/freeze": `<h1>FREEZE</h1><script>setTimeout(() => { while (true) {} }, 100);</script>`,
      "/storage": "<h1>STORAGE</h1>",
    };
    server = http.createServer((req, res) => {
      const route = req.url.split("?")[0];
      if (route === "/download") {
        res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Disposition": "attachment; filename=x.bin" });
        return res.end("BINARY");
      }
      if (!(route in pages)) return res.writeHead(404).end();
      res.writeHead(200, { "Content-Type": "text/html" }).end(`<!doctype html><html><body>${pages[route]}</body></html>`);
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = server.address().port;
    // A literal 127.0.0.1 is a potentially trustworthy origin (secure context), needed to test permissions.
    // The policy only allows this port.
    policy = {
      ports: new Set([80, 443, port]),
      lookup: async () => {
        throw new Error("ENOTFOUND");
      },
      allow: (ip, p) => ip === "127.0.0.1" && p === port,
    };
    browser = await launchGuardedChromium(CHROMIUM, policy, [...SANDBOX_ARGS, marker]);
  });

  after(async () => {
    await browser?.close();
    server?.close();
  });

  const at = (p) => `http://127.0.0.1:${port}${p}`;
  const open = async (p) => {
    const page = await newSandboxedPage(browser);
    await gotoAllowed(page, at(p), { waitUntil: "domcontentloaded" }, policy);
    return page;
  };

  test("downloads are cancelled", async () => {
    const page = await open("/download-page");
    const [download] = await Promise.all([page.waitForEvent("download", { timeout: 5000 }), page.click("#d")]);
    assert.notEqual(await download.failure(), null);
    await page.close();
  });

  test("popups and window.open close by themselves", async () => {
    const page = await open("/popup");
    const context = page.context();
    const onlyOne = await waitFor(() => context.pages().length === 1, 3000);
    assert.ok(onlyOne, `open pages: ${context.pages().length}`);
    assert.match(await page.content(), /POPUP-PAGE/);
    await page.close();
  });

  test("alert, confirm and prompt are dismissed and the page goes on", async () => {
    const page = await open("/dialogs");
    assert.equal(await evaluateWithTimeout(page, "document.title", 3000), "after-dialogs");
    assert.equal(await page.evaluate("window.__confirm"), false);
    assert.equal(await page.evaluate("window.__prompt"), null);
    await page.close();
  });

  test("permissions: location, camera, microphone and notifications denied", async () => {
    const page = await open("/ok");
    const result = await evaluateWithTimeout(
      page,
      `(async () => {
        const geo = await new Promise((resolve) =>
          navigator.geolocation.getCurrentPosition(() => resolve('granted'), (e) => resolve('error ' + e.code), { timeout: 3000 })
        );
        const media = async (constraints) => {
          try { await navigator.mediaDevices.getUserMedia(constraints); return 'granted'; }
          catch (e) { return e.name; }
        };
        return {
          secure: window.isSecureContext,
          geo,
          camera: await media({ video: true }),
          microphone: await media({ audio: true }),
          notifications: await Notification.requestPermission(),
        };
      })()`,
      8000
    );
    assert.equal(result.secure, true, "the test origin must be a secure context");
    assert.equal(result.geo, "error 1"); // PERMISSION_DENIED
    assert.notEqual(result.camera, "granted");
    assert.notEqual(result.microphone, "granted");
    assert.equal(result.notifications, "denied");
    await page.close();
  });

  test(`a page that navigates by itself forever is closed (cap ${MAX_NAVIGATIONS_PER_PAGE})`, async () => {
    const page = await open("/loop");
    assert.ok(await waitFor(() => page.isClosed(), 15000), "the page is still open");
  });

  test("a hung script (while true) doesn't block: evaluate with a timeout", async () => {
    const page = await open("/freeze");
    await new Promise((r) => setTimeout(r, 300));
    const started = Date.now();
    await assert.rejects(evaluateWithTimeout(page, "1 + 1", 1000), /did not respond/);
    assert.ok(Date.now() - started < 3000);
    await page.close();
  });

  test("isolation: each page in a fresh context, no inherited cookies or storage", async () => {
    const first = await open("/storage");
    await first.evaluate("document.cookie = 'spector=1; path=/'; localStorage.setItem('spector', '1'); sessionStorage.setItem('spector', '1');");
    assert.match(await first.evaluate("document.cookie"), /spector=1/);
    const second = await open("/storage");
    assert.notEqual(first.context(), second.context());
    assert.equal(await second.evaluate("document.cookie"), "");
    assert.equal(await second.evaluate("localStorage.getItem('spector')"), null);
    assert.equal(await second.evaluate("sessionStorage.getItem('spector')"), null);
    await first.close();
    await second.close();
  });

  test("closing the page closes its context", async () => {
    const page = await open("/ok");
    const context = page.context();
    await page.close();
    assert.ok(await waitFor(() => !browser.contexts().includes(context), 3000));
  });
});

// ---- Guaranteed cleanup ----
describe("guaranteed cleanup", { skip: !fs.existsSync(CHROMIUM) && "Chromium is not installed" }, () => {
  let server, port, policy;

  before(async () => {
    server = http.createServer((req, res) => {
      const freeze = req.url.startsWith("/freeze");
      res.writeHead(200, { "Content-Type": "text/html" }).end(
        freeze ? `<script>setTimeout(() => { while (true) {} }, 50);</script>` : "<h1>OK</h1>"
      );
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = server.address().port;
    policy = {
      ports: new Set([80, 443, port]),
      lookup: async () => {
        throw new Error("ENOTFOUND");
      },
      allow: (ip, p) => ip === "127.0.0.1" && p === port,
    };
  });

  after(() => server?.close());

  // A guarded browser registered in the session, with its own marker to find its process.
  const launch = async (marker) =>
    trackBrowser(await launchGuardedChromium(CHROMIUM, policy, [...SANDBOX_ARGS, marker]));

  const noProcessLeft = (marker) => waitFor(() => chromiumProcessesWith(marker) === 0, 10000);

  test("normal path: no Chromium left after the analysis", async () => {
    const marker = `--spector-test-run=${randomUUID()}`;
    let seen = 0;
    await withAnalysisDeadline(async () => {
      const browser = await launch(marker);
      seen = chromiumProcessesWith(marker);
      const page = await newSandboxedPage(browser);
      await gotoAllowed(page, `http://127.0.0.1:${port}/ok`, {}, policy);
      // Deliberately not closed: the session closes it.
    }, 30000);
    assert.ok(seen >= 1, "the test must see the process while it runs");
    assert.ok(await noProcessLeft(marker), "a Chromium was left open");
  });

  test("error path: closed even when the analysis fails", async () => {
    const marker = `--spector-test-run=${randomUUID()}`;
    await assert.rejects(
      withAnalysisDeadline(async () => {
        await launch(marker);
        throw new Error("boom");
      }, 30000),
      /boom/
    );
    assert.ok(await noProcessLeft(marker), "a Chromium was left open");
  });

  test("timeout: a hung page doesn't keep the analysis waiting, and Chromium closes", async () => {
    const marker = `--spector-test-run=${randomUUID()}`;
    const started = Date.now();
    await assert.rejects(
      withAnalysisDeadline(async () => {
        const browser = await launch(marker);
        const page = await newSandboxedPage(browser);
        await gotoAllowed(page, `http://127.0.0.1:${port}/freeze`, {}, policy);
        await new Promise((r) => setTimeout(r, 200));
        // page.evaluate without a cap would wait forever.
        await page.evaluate("1 + 1");
      }, 3000),
      (error) => error instanceof AnalysisTimeoutError
    );
    assert.ok(Date.now() - started < 8000, `took ${Date.now() - started} ms`);
    assert.ok(await noProcessLeft(marker), "a Chromium was left open");
  });

  test("a browser launched after the deadline is closed and fails", async () => {
    const marker = `--spector-test-run=${randomUUID()}`;
    await assert.rejects(
      withAnalysisDeadline(async () => {
        await new Promise((r) => setTimeout(r, 1500));
        return "never";
      }, 500),
      AnalysisTimeoutError
    );
    // The task kept running in the background: simulates a stage that starts late.
    await assert.rejects(
      withAnalysisDeadline(async () => {
        await new Promise((r) => setTimeout(r, 700));
        await launch(marker);
      }, 300).then(() => new Promise((r) => setTimeout(r, 1500))),
      AnalysisTimeoutError
    );
    await new Promise((r) => setTimeout(r, 1500));
    assert.ok(await noProcessLeft(marker), "a Chromium was left open");
  });
});

// ---- Close timeout ----
describe("close timeout", () => {
  // Stands in for a hung Chromium: close() never settles.
  const hungBrowser = () => ({ close: () => new Promise(() => {}), on: () => {} });

  test(`a browser whose close() never settles doesn't hang the analysis past ${BROWSER_CLOSE_TIMEOUT_MS / 1000} s`, { timeout: BROWSER_CLOSE_TIMEOUT_MS + 5000 }, async () => {
    const started = Date.now();
    const result = await withAnalysisDeadline(async () => {
      await trackBrowser(hungBrowser());
      return "done";
    }, 30_000);
    const elapsed = Date.now() - started;
    assert.equal(result, "done");
    assert.ok(elapsed >= BROWSER_CLOSE_TIMEOUT_MS - 100, `settled too early: ${elapsed} ms`);
    assert.ok(elapsed < BROWSER_CLOSE_TIMEOUT_MS + 2000, `took ${elapsed} ms`);
  });
});
