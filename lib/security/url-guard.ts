import dns from "node:dns";
import http from "node:http";
import net from "node:net";
import { chromium, type Browser, type Page } from "playwright-core";

// Validador único de las URLs que llegan al navegador (SSRF).
//
// Dos capas, con la misma regla:
// 1. assertAllowedUrl: la URL que manda el usuario, antes de abrir nada.
// 2. El proxy de salida: el Chromium del análisis sale a la red solo a
//    través de él. Valida cada conexión (navegación, redirección,
//    subrecurso, iframe) contra la IP a la que de verdad se conecta. Así
//    una URL pública que redirige a 127.0.0.1, o un dominio que cambia de
//    IP entre la validación y la conexión (DNS rebinding), no pasan: no
//    hay una segunda resolución de DNS que el atacante pueda controlar.
//
// Este módulo solo importa módulos de Node y playwright-core: los tests
// lo cargan directamente con `node --test`.

// Mensaje único para cualquier rechazo. No dice si el host existe, si el
// puerto está abierto ni qué regla falló: con eso el validador serviría
// para escanear la red.
export const URL_NOT_ALLOWED = "This URL is not allowed.";

export class UrlNotAllowedError extends Error {
  constructor() {
    super(URL_NOT_ALLOWED);
    this.name = "UrlNotAllowedError";
  }
}

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

// Solo los puertos web estándar, a propósito: un sitio público en :8080
// no se puede analizar, pero tampoco se puede tocar un servicio interno
// en cualquier puerto de una IP pública que el atacante controle.
const ALLOWED_PORTS: ReadonlySet<number> = new Set([80, 443]);

const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal"];

// Rangos privados y especiales. Además de los pedidos, CGNAT, multicast,
// reservados, IPv6 único-local, link-local y multicast: tampoco son
// Internet pública.
const BLOCKED_RANGES = new net.BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // incluye 169.254.169.254, metadatos de nube
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4], // incluye 255.255.255.255
] as const) {
  BLOCKED_RANGES.addSubnet(address, prefix, "ipv4");
}
for (const [address, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  BLOCKED_RANGES.addSubnet(address, prefix, "ipv6");
}

// IPv4 mapeada (::ffff:0:0/96, como ::ffff:127.0.0.1), entera. Va aparte
// y solo se consulta con direcciones IPv6: BlockList compara cada IPv4
// contra las reglas IPv6 en su forma mapeada, y en la lista general esta
// regla bloquearía todo IPv4.
const IPV4_MAPPED = new net.BlockList();
IPV4_MAPPED.addSubnet("::ffff:0:0", 96, "ipv6");

export function isBlockedAddress(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return BLOCKED_RANGES.check(ip, "ipv4");
  if (family === 6) return IPV4_MAPPED.check(ip, "ipv6") || BLOCKED_RANGES.check(ip, "ipv6");
  return true;
}

// "[::1]" → "::1", "LOCALHOST." → "localhost".
const normalizeHost = (host: string) =>
  host.replace(/^\[/, "").replace(/\]$/, "").replace(/\.+$/, "").toLowerCase();

const isBlockedName = (host: string) =>
  host === "localhost" || BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix));

export interface GuardPolicy {
  ports: ReadonlySet<number>;
  lookup: (host: string) => Promise<string[]>;
  // Excepción explícita ip:puerto al bloqueo de rangos. Solo la usan los
  // tests, donde un servidor local hace de sitio "público".
  allow?: (ip: string, port: number) => boolean;
}

const systemLookup = async (host: string): Promise<string[]> =>
  (await dns.promises.lookup(host, { all: true, verbatim: true })).map((a) => a.address);

export const DEFAULT_POLICY: GuardPolicy = { ports: ALLOWED_PORTS, lookup: systemLookup };

// La IP a la que conectarse para host:puerto, o UrlNotAllowedError. Si el
// nombre resuelve a varias IPs, todas deben estar permitidas: si no, el
// atacante mezcla una pública con 127.0.0.1 y gana la que toque.
export async function resolveAllowed(
  host: string,
  port: number,
  policy: GuardPolicy = DEFAULT_POLICY
): Promise<string> {
  if (!policy.ports.has(port)) throw new UrlNotAllowedError();
  const name = normalizeHost(host);
  if (!name || isBlockedName(name)) throw new UrlNotAllowedError();

  const addresses = net.isIP(name) ? [name] : await policy.lookup(name).catch(() => []);
  if (addresses.length === 0) throw new UrlNotAllowedError();
  const permitted = (ip: string) => policy.allow?.(ip, port) === true || !isBlockedAddress(ip);
  if (!addresses.every(permitted)) throw new UrlNotAllowedError();
  return addresses[0];
}

const portOf = (url: URL) => (url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80);

// La URL del usuario: esquema, host, puerto y la IP resuelta. new URL ya
// normaliza las formas raras de IPv4 ("2130706433", "0x7f000001",
// "127.1") a la forma con puntos.
export async function assertAllowedUrl(raw: string, policy: GuardPolicy = DEFAULT_POLICY): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UrlNotAllowedError();
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) throw new UrlNotAllowedError();
  await resolveAllowed(url.hostname, portOf(url), policy);
  return url;
}

// ============================================================
// Proxy de salida del navegador
// ============================================================
export interface EgressProxy {
  server: string;
  // Conexiones rechazadas desde que arrancó: gotoAllowed lo usa para
  // distinguir "el sitio no cargó" de "el validador lo cortó".
  blockedCount: () => number;
  close: () => Promise<void>;
}

// "host:puerto" de un CONNECT, IPv6 entre corchetes incluida.
function parseAuthority(authority: string): { host: string; port: number } | null {
  const colon = authority.lastIndexOf(":");
  if (colon <= 0) return null;
  const port = Number(authority.slice(colon + 1));
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;
  return { host: authority.slice(0, colon), port };
}

export async function startEgressProxy(policy: GuardPolicy = DEFAULT_POLICY): Promise<EgressProxy> {
  let blocked = 0;
  const sockets = new Set<net.Socket>();
  const track = (socket: net.Socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
  };

  const server = http.createServer();
  server.on("connection", track);

  // HTTPS (y WebSockets): túnel CONNECT hacia la IP ya validada.
  server.on("connect", async (req: http.IncomingMessage, client: net.Socket, head: Buffer) => {
    const target = parseAuthority(req.url ?? "");
    let ip: string;
    try {
      if (!target) throw new UrlNotAllowedError();
      ip = await resolveAllowed(target.host, target.port, policy);
    } catch {
      blocked += 1;
      client.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      return;
    }

    let established = false;
    const upstream = net.connect(target.port, ip, () => {
      established = true;
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length > 0) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    track(upstream);
    upstream.on("error", () => {
      if (established) client.destroy();
      else client.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
    });
    client.on("close", () => upstream.destroy());
  });

  // HTTP plano: el navegador manda la URL absoluta y el proxy reenvía la
  // petición a la IP ya validada, con el Host original.
  server.on("request", async (req: http.IncomingMessage, res: http.ServerResponse) => {
    let url: URL;
    let ip: string;
    try {
      url = new URL(req.url ?? "");
      if (url.protocol !== "http:") throw new UrlNotAllowedError();
      ip = await resolveAllowed(url.hostname, portOf(url), policy);
    } catch {
      blocked += 1;
      res.writeHead(403).end();
      return;
    }

    const headers = { ...req.headers };
    delete headers["proxy-connection"];
    delete headers["proxy-authorization"];
    const upstream = http.request(
      { host: ip, port: portOf(url), method: req.method, path: url.pathname + url.search, headers, setHost: false },
      (response) => {
        res.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(res);
      }
    );
    upstream.on("error", () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    req.pipe(upstream);
  });

  // Upgrade sin CONNECT: Chromium no lo usa con un proxy; no se reenvía.
  server.on("upgrade", (_req: http.IncomingMessage, socket: net.Socket) => socket.destroy());

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as net.AddressInfo;

  return {
    server: `http://127.0.0.1:${port}`,
    blockedCount: () => blocked,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

// ============================================================
// Navegador
// ============================================================
const proxies = new WeakMap<Browser, EgressProxy>();

// Chromium con todo su tráfico por el proxy de salida. Sin `bypass`,
// Playwright añade <-loopback> a la lista de excepciones de Chromium, así
// que localhost y 127.0.0.1 también pasan por el proxy en vez de salir
// directo. WebRTC queda limitado a lo que va por el proxy (sin UDP propio).
export async function launchGuardedChromium(
  executablePath: string,
  policy: GuardPolicy = DEFAULT_POLICY,
  args: string[] = []
): Promise<Browser> {
  const proxy = await startEgressProxy(policy);
  try {
    const browser = await chromium.launch({
      executablePath,
      headless: true,
      proxy: { server: proxy.server },
      args: ["--force-webrtc-ip-handling-policy=disable_non_proxied_udp", ...args],
    });
    proxies.set(browser, proxy);
    browser.on("disconnected", () => void proxy.close());
    return browser;
  } catch (error) {
    await proxy.close();
    throw error;
  }
}

// La única forma de abrir una URL en el navegador del análisis. Valida la
// URL, exige que el navegador salga por el proxy (si no, falla cerrado) y
// convierte un corte del proxy en el mismo mensaje genérico.
export async function gotoAllowed(
  page: Page,
  url: string,
  options: Parameters<Page["goto"]>[1] = {},
  policy: GuardPolicy = DEFAULT_POLICY
): Promise<void> {
  await assertAllowedUrl(url, policy);
  const browser = page.context().browser();
  const proxy = browser ? proxies.get(browser) : undefined;
  if (!proxy) throw new Error("The browser was not launched through launchGuardedChromium.");

  const before = proxy.blockedCount();
  try {
    await page.goto(url, options);
  } catch (error) {
    if (proxy.blockedCount() > before) throw new UrlNotAllowedError();
    throw error;
  }
}
