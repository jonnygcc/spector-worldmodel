// Stops others from spending the user's quota: application/json forces a CORS preflight, and foreign
// Origins and non-loopback Hosts (DNS rebinding) are rejected. No Origin means no browser, so it passes.

export interface HeaderReader {
  get(name: string): string | null;
}

export type GuardResult = { ok: true } | { ok: false; status: number; error: string };

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

// Host without port: "localhost:3000" → "localhost", "[::1]:3000" → "[::1]".
function hostnameOf(host: string): string {
  const value = host.trim().toLowerCase();
  if (value.startsWith("[")) return value.slice(0, value.indexOf("]") + 1);
  return value.split(":")[0];
}

export function checkApiRequest(headers: HeaderReader): GuardResult {
  const host = headers.get("host");
  if (!host || !LOOPBACK.has(hostnameOf(host))) {
    return { ok: false, status: 403, error: "This server only accepts requests made on this machine." };
  }

  const origin = headers.get("origin");
  if (origin !== null) {
    let originHost: string | null = null;
    try {
      const url = new URL(origin);
      if (url.protocol === "http:" || url.protocol === "https:") originHost = url.host.toLowerCase();
    } catch {
      // "null" (sandboxed iframe, file:) or anything that isn't a URL.
    }
    if (originHost !== host.trim().toLowerCase()) {
      return { ok: false, status: 403, error: "Cross-origin requests are not allowed." };
    }
  }

  // Extra defense from the browsers that send it.
  const site = headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin" && site !== "none") {
    return { ok: false, status: 403, error: "Cross-origin requests are not allowed." };
  }

  const type = headers.get("content-type") ?? "";
  if (!/^application\/json\s*(;|$)/i.test(type)) {
    return { ok: false, status: 415, error: "Content-Type must be application/json." };
  }
  return { ok: true };
}

// An already-aborted signal never fires "abort", and request.signal arrives
// aborted if the client left while the route was still validating.
export function linkAbort(source: AbortSignal, target: AbortController): () => void {
  if (source.aborted) {
    target.abort(source.reason);
    return () => {};
  }
  const onAbort = () => target.abort(source.reason);
  source.addEventListener("abort", onAbort, { once: true });
  return () => source.removeEventListener("abort", onAbort);
}

type BodyResult = { ok: true; text: string } | { ok: false; status: number; error: string };
const TOO_LARGE: BodyResult = { ok: false, status: 413, error: "The request is too large." };

// Reads the stream chunk by chunk: request.text() buffered a chunked body (no Content-Length)
// whole before the cap could apply.
export async function readBody(
  request: { headers: HeaderReader; body: ReadableStream<Uint8Array> | null },
  maxChars: number
): Promise<BodyResult> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxChars * 4) return TOO_LARGE;
  if (!request.body) return { ok: true, text: "" };

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      if (text.length > maxChars) {
        await reader.cancel().catch(() => {});
        return TOO_LARGE;
      }
    }
    text += decoder.decode();
  } catch {
    return { ok: true, text: "" };
  }
  return text.length > maxChars ? TOO_LARGE : { ok: true, text };
}
