import type { NavigationExpectation, RouteStep } from "./goal-types";

// Validación de la salida del modelo antes de actuar en el navegador. El
// modelo elige qué pulsar y qué escribir; una página puede intentar
// dirigirlo, así que aquí se acota qué puede pedir.
//
// Módulo sin dependencias de runtime (solo tipos): los tests lo cargan con
// `node --test`.

export const STEP_TYPES = ["click", "type", "press", "scroll"] as const;
export const TARGET_TYPES = ["button", "link", "input"] as const;

// Teclas que un paso "press" puede pulsar: enviar, cerrar, moverse por una
// lista. Nada de atajos ni combinaciones.
export const ALLOWED_KEYS = ["Enter", "Escape", "Tab", "ArrowDown", "ArrowUp"] as const;

// Largo máximo de lo que el agente escribe en un campo: un email, una
// búsqueda, un nombre. Más que eso se recorta.
export const MAX_TYPED_VALUE = 100;
const MAX_DESCRIPTION = 200;
const MAX_TARGET = 120;
const MAX_HINT = 100;
const MAX_SIGNAL = 60;

const clip = (text: string, max: number) => text.replace(/\s+/g, " ").trim().slice(0, max);
const isOneOf = <T extends string>(list: readonly T[], value: unknown): value is T =>
  typeof value === "string" && (list as readonly string[]).includes(value);

// Un paso en forma válida, o null si no se puede ejecutar tal como vino:
// tipo desconocido, tecla fuera de la lista, o un click/type sin elemento.
export function sanitizeStep(raw: Partial<RouteStep> | null | undefined, order: number): RouteStep | null {
  if (!raw || !isOneOf(STEP_TYPES, raw.type)) return null;
  const type = raw.type;

  const targetElement = typeof raw.targetElement === "string" ? clip(raw.targetElement, MAX_TARGET) : "";
  if ((type === "click" || type === "type") && !targetElement) return null;

  let value: string | undefined;
  if (type === "press") {
    if (!isOneOf(ALLOWED_KEYS, raw.value ?? "Enter")) return null;
    value = raw.value ?? "Enter";
  } else if (type === "type") {
    value = typeof raw.value === "string" ? raw.value.slice(0, MAX_TYPED_VALUE) : "";
  }

  const nav: NavigationExpectation =
    raw.navigationExpected === "navigate" || raw.navigationExpected === "same-page" ? raw.navigationExpected : "unknown";
  const hint =
    typeof raw.expectedUrlHint === "string" && raw.expectedUrlHint.trim() ? clip(raw.expectedUrlHint, MAX_HINT) : null;
  const signals = Array.isArray(raw.expectedSignals)
    ? raw.expectedSignals
        .filter((x): x is string => typeof x === "string" && x.trim() !== "")
        .map((x) => clip(x, MAX_SIGNAL))
        .slice(0, 3)
    : [];

  return {
    order,
    type,
    description: typeof raw.description === "string" ? clip(raw.description, MAX_DESCRIPTION) : "",
    targetElement,
    targetType: isOneOf(TARGET_TYPES, raw.targetType) ? raw.targetType : "button",
    value,
    navigationExpected: nav,
    expectedUrlHint: hint,
    expectedSignals: signals,
  };
}

// Los pasos válidos de una lista, renumerados. Un paso inválido se
// descarta; no se adivina qué quería decir.
export function sanitizeSteps(raw: unknown, max: number): RouteStep[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((step, i) => sanitizeStep(step as Partial<RouteStep>, i + 1))
    .filter((step): step is RouteStep => step !== null)
    .slice(0, max)
    .map((step, i) => ({ ...step, order: i + 1 }));
}

// ¿La URL sigue en el sitio analizado? Sin lista de sufijos públicos: un
// host es del sitio si es el mismo, o uno es subdominio del otro (sin
// "www."). shop.x.com y x.com sí; x.github.io e y.github.io, o
// bbc.co.uk y otro.co.uk, no. Un login en otro dominio corta la ruta: es
// el precio de no dejar que una página mande al agente a otro sitio.
export function siteHost(url: string): string | null {
  try {
    const { protocol, hostname } = new URL(url);
    if (protocol !== "http:" && protocol !== "https:") return null;
    return hostname.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function sameSite(siteUrl: string, url: string): boolean {
  const a = siteHost(siteUrl);
  const b = siteHost(url);
  if (!a || !b) return false;
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}
