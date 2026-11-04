// Origen y tipo de contenido de las rutas API (paso 9).
//
// Spector corre en la máquina de cada usuario, con su clave de Gemini. La
// amenaza es que otra cosa gaste esa cuota sin que el usuario lo pida:
// - Una web cualquiera que el usuario visita (CSRF). Un POST text/plain es
//   una "simple request": el navegador lo manda sin preflight. Exigir
//   application/json obliga al preflight, y sin cabeceras CORS el navegador
//   no llega a mandar la petición. Además, un Origin que no es el propio
//   servidor se rechaza.
// - Un dominio que re-resuelve a 127.0.0.1 (DNS rebinding): la petición es
//   del mismo origen para el navegador, pero el Host es el del atacante.
//   Solo se aceptan Host de loopback.
//
// Sin Origin (curl, un script local) se acepta: un navegador siempre lo
// manda en un POST, así que su ausencia no es CSRF.
//
// Módulo sin dependencias: los tests lo cargan con `node --test`.

export interface HeaderReader {
  get(name: string): string | null;
}

export type GuardResult = { ok: true } | { ok: false; status: number; error: string };

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

// Host sin puerto: "localhost:3000" → "localhost", "[::1]:3000" → "[::1]".
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
      // "null" (iframe con sandbox, file:) u otro valor que no es una URL.
    }
    if (originHost !== host.trim().toLowerCase()) {
      return { ok: false, status: 403, error: "Cross-origin requests are not allowed." };
    }
  }

  // Defensa adicional: los navegadores que la mandan dicen de dónde viene.
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

// Cuerpo con tope: primero Content-Length, después el texto real.
export async function readBody(
  request: { headers: HeaderReader; text(): Promise<string> },
  maxChars: number
): Promise<{ ok: true; text: string } | { ok: false; status: number; error: string }> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxChars * 4) {
    return { ok: false, status: 413, error: "The request is too large." };
  }
  const text = await request.text().catch(() => "");
  if (text.length > maxChars) return { ok: false, status: 413, error: "The request is too large." };
  return { ok: true, text };
}
