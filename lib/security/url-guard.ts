import dns from "node:dns";
import http from "node:http";
import net from "node:net";
import { chromium, type Browser, type Page } from "playwright-core";

// One rule in two layers: assertAllowedUrl before anything opens, and an egress proxy that checks every
// connection against the IP actually dialed, so redirects and DNS rebinding can't get past it.

// One message for every rejection: saying which rule failed would turn the validator into a network scanner.
export const URL_NOT_ALLOWED = "This URL is not allowed.";

export class UrlNotAllowedError extends Error {
  constructor() {
    super(URL_NOT_ALLOWED);
    this.name = "UrlNotAllowedError";
  }
}

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

// Standard web ports only, on purpose: a public site on :8080 can't be analyzed, but no service on
// another port of an attacker's IP can be reached either.
const ALLOWED_PORTS: ReadonlySet<number> = new Set([80, 443]);

const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal"];

// Besides the requested ranges: CGNAT, multicast, reserved, IPv6 unique-local and link-local,
// none of which is the public Internet.
const BLOCKED_RANGES = new net.BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // includes 169.254.169.254, cloud metadata
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4], // includes 255.255.255.255
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

// IPv4-mapped (::ffff:0:0/96) lives apart and is only checked for IPv6: BlockList matches every IPv4
// against IPv6 rules in mapped form, so in the main list this rule would block all IPv4.
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
  // Explicit ip:port exception to the range block, only for tests where a local server plays a "public" site.
  allow?: (ip: string, port: number) => boolean;
}

const systemLookup = async (host: string): Promise<string[]> =>
  (await dns.promises.lookup(host, { all: true, verbatim: true })).map((a) => a.address);

export const DEFAULT_POLICY: GuardPolicy = { ports: ALLOWED_PORTS, lookup: systemLookup };

// Every resolved IP must be allowed; otherwise an attacker mixes a public IP with 127.0.0.1 and wins
// whenever that one is picked.
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

// new URL already normalizes odd IPv4 forms ("2130706433", "0x7f000001", "127.1") to dotted form.
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

// ---- Browser egress proxy ----
export interface EgressProxy {
  server: string;
  // Rejections since start: gotoAllowed uses it to tell "the site didn't load" from "the guard cut it".
  blockedCount: () => number;
  close: () => Promise<void>;
}

// "host:port" of a CONNECT, bracketed IPv6 included.
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

  // HTTPS (and WebSockets): a CONNECT tunnel to the already-validated IP.
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

  // Plain HTTP: the browser sends the absolute URL and the proxy forwards it to the validated IP,
  // keeping the original Host.
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

  // Upgrade without CONNECT: Chromium doesn't use it behind a proxy, so it isn't forwarded.
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

// ---- Browser ----
const proxies = new WeakMap<Browser, EgressProxy>();

// Without `bypass`, Playwright adds <-loopback> to Chromium's bypass list, so localhost and 127.0.0.1
// also go through the proxy. WebRTC is limited to proxied traffic (no UDP of its own).
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

// The only way to open a URL in the analysis browser: fails closed if the browser isn't behind the
// proxy, and turns a proxy cut into the same generic message.
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
