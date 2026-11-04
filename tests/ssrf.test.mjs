// Tests del validador de URLs (lib/security/url-guard.ts): `npm test`.
// Node carga el .ts directamente (type stripping).
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import {
  assertAllowedUrl,
  gotoAllowed,
  isBlockedAddress,
  launchGuardedChromium,
  URL_NOT_ALLOWED,
  UrlNotAllowedError,
} from "../lib/security/url-guard.ts";

// Resolución de DNS falsa: los tests no dependen de la red.
const fakeDns = (table) => ({
  ports: new Set([80, 443]),
  lookup: async (host) => {
    if (!(host in table)) throw new Error("ENOTFOUND");
    return table[host];
  },
});
const PUBLIC_DNS = fakeDns({ "example.com": ["93.184.215.14"] });

async function rejects(url, policy = PUBLIC_DNS) {
  await assert.rejects(assertAllowedUrl(url, policy), (error) => {
    assert.ok(error instanceof UrlNotAllowedError, `${url}: ${error}`);
    assert.equal(error.message, URL_NOT_ALLOWED);
    return true;
  });
}

describe("esquemas", () => {
  for (const url of [
    "file:///C:/Users/user/spector-worldmodel/.env.local",
    "file:///etc/passwd",
    "data:text/html,<h1>hi</h1>",
    "ftp://example.com/",
    "blob:https://example.com/0f3c",
    "javascript:alert(1)",
    "ws://example.com/",
    "chrome://settings",
    "not a url",
  ]) {
    test(`rechaza ${url}`, () => rejects(url));
  }
  test("acepta http y https públicos", async () => {
    await assertAllowedUrl("http://example.com/", PUBLIC_DNS);
    await assertAllowedUrl("https://example.com/path?q=1", PUBLIC_DNS);
  });
});

describe("nombres locales", () => {
  for (const url of [
    "http://localhost/",
    "http://LOCALHOST./",
    "https://app.localhost/",
    "http://printer.local/",
    "http://metadata.google.internal/",
    "http://api.corp.internal/",
  ]) {
    test(`rechaza ${url}`, () => rejects(url));
  }
});

describe("rangos privados y especiales", () => {
  for (const url of [
    "http://127.0.0.1/",
    "http://127.8.9.10/",
    "http://127.1/", // forma corta de 127.0.0.1
    "http://2130706433/", // 127.0.0.1 en decimal
    "http://0x7f000001/", // 127.0.0.1 en hexadecimal
    "http://[::1]/",
    "http://10.0.0.1/",
    "http://10.255.255.255/",
    "http://172.16.0.1/",
    "http://172.31.255.255/",
    "http://192.168.1.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://169.254.1.1/",
    "http://0.0.0.0/",
    "http://0.1.2.3/",
    "http://[::ffff:127.0.0.1]/",
    "http://[::ffff:7f00:1]/",
    "http://[::ffff:a00:1]/", // 10.0.0.1 mapeada
    "http://[::]/",
    "http://[fd00::1]/",
    "http://[fe80::1]/",
  ]) {
    test(`rechaza ${url}`, () => rejects(url));
  }
  test("acepta los vecinos públicos de los rangos", () => {
    assert.equal(isBlockedAddress("172.15.255.255"), false);
    assert.equal(isBlockedAddress("172.32.0.1"), false);
    assert.equal(isBlockedAddress("11.0.0.1"), false);
    assert.equal(isBlockedAddress("8.8.8.8"), false);
    assert.equal(isBlockedAddress("2606:4700:4700::1111"), false);
  });
});

describe("DNS: se valida la IP resuelta, no la cadena", () => {
  const dns = fakeDns({
    "evil.example": ["127.0.0.1"],
    "meta.example": ["169.254.169.254"],
    "mixed.example": ["93.184.215.14", "10.0.0.5"],
    "v6.example": ["::1"],
  });
  for (const url of [
    "http://evil.example/",
    "https://meta.example/",
    "http://mixed.example/", // una pública y una privada: basta una
    "http://v6.example/",
    "http://does-not-exist.example/", // sin resolución: mismo rechazo
  ]) {
    test(`rechaza ${url}`, () => rejects(url, dns));
  }
});

describe("puertos", () => {
  for (const url of [
    "http://example.com:8080/",
    "http://example.com:22/",
    "https://example.com:8443/",
    "http://example.com:6379/",
  ]) {
    test(`rechaza ${url}`, () => rejects(url));
  }
  test("acepta 80 y 443 explícitos", async () => {
    await assertAllowedUrl("http://example.com:80/", PUBLIC_DNS);
    await assertAllowedUrl("https://example.com:443/", PUBLIC_DNS);
  });
});

// ============================================================
// Navegador real: redirecciones y subrecursos pasan por el proxy
// ============================================================
// Dos servidores en 127.0.0.1. El "público" es una excepción explícita de
// la política (solo su puerto); el "interno" no lo es, y cuenta cuántas
// veces lo tocan: tiene que quedar en 0.
const CHROMIUM =
  process.env.SPECTOR_CHROMIUM_PATH ??
  "C:/Users/user/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe";

describe("navegador", { skip: !fs.existsSync(CHROMIUM) && "Chromium no está instalado" }, () => {
  let publicServer, internalServer, publicPort, internalPort, policy, browser;
  let internalHits = 0;

  const listen = (server) =>
    new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));

  before(async () => {
    internalServer = http.createServer((_req, res) => {
      internalHits += 1;
      res.end("INTERNAL-SECRET");
    });
    internalPort = await listen(internalServer);

    publicServer = http.createServer((req, res) => {
      const routes = {
        "/ok": () => res.end("<h1>PUBLIC-OK</h1>"),
        "/redirect-ip": () => res.writeHead(302, { Location: `http://127.0.0.1:${internalPort}/` }).end(),
        "/redirect-name": () => res.writeHead(302, { Location: `http://rebind.test:${internalPort}/` }).end(),
        "/redirect-localhost": () => res.writeHead(302, { Location: `http://localhost:${internalPort}/` }).end(),
        "/redirect-file": () => res.writeHead(302, { Location: "file:///C:/Windows/win.ini" }).end(),
        "/frame": () =>
          res.end(
            `<h1>FRAME-PAGE</h1><iframe src="http://127.0.0.1:${internalPort}/"></iframe>` +
              `<img src="http://rebind.test:${internalPort}/pixel">`
          ),
      };
      (routes[req.url] ?? (() => res.writeHead(404).end()))();
    });
    publicPort = await listen(publicServer);

    policy = {
      ports: new Set([80, 443, publicPort, internalPort]),
      lookup: async (host) => {
        if (host === "public.test" || host === "rebind.test") return ["127.0.0.1"];
        throw new Error("ENOTFOUND");
      },
      allow: (ip, port) => ip === "127.0.0.1" && port === publicPort,
    };
    browser = await launchGuardedChromium(CHROMIUM, policy);
  });

  after(async () => {
    await browser?.close();
    publicServer?.close();
    internalServer?.close();
  });

  const open = async (path) => {
    const page = await browser.newPage();
    try {
      await gotoAllowed(page, `http://public.test:${publicPort}${path}`, { timeout: 15000 }, policy);
      return await page.content();
    } finally {
      await page.close();
    }
  };

  test("control: el sitio público carga a través del proxy", async () => {
    assert.match(await open("/ok"), /PUBLIC-OK/);
  });

  for (const path of ["/redirect-ip", "/redirect-name", "/redirect-localhost"]) {
    test(`redirección a un host interno (${path}) queda bloqueada`, async () => {
      await assert.rejects(open(path), (error) => {
        assert.ok(error instanceof UrlNotAllowedError, String(error));
        assert.equal(error.message, URL_NOT_ALLOWED);
        return true;
      });
      assert.equal(internalHits, 0);
    });
  }

  test("redirección a file: no lee el archivo", async () => {
    let content = "";
    try {
      content = await open("/redirect-file");
    } catch {
      // Chromium no sigue un redirect http → file: y la navegación falla.
    }
    assert.doesNotMatch(content, /\[fonts\]|for 16-bit app support/i);
  });

  test("iframes e imágenes hacia hosts internos no se cargan", async () => {
    assert.match(await open("/frame"), /FRAME-PAGE/);
    assert.equal(internalHits, 0);
  });

  test("navegar fuera de un navegador vigilado falla cerrado", async () => {
    const { chromium } = await import("playwright-core");
    const unguarded = await chromium.launch({ executablePath: CHROMIUM, headless: true });
    try {
      const page = await unguarded.newPage();
      await assert.rejects(gotoAllowed(page, `http://public.test:${publicPort}/ok`, {}, policy), /launchGuardedChromium/);
    } finally {
      await unguarded.close();
    }
  });
});
