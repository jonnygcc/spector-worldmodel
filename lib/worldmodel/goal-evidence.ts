import type { Route } from "./goal-types";

// Evidencia de que una ruta llegó al objetivo, comprobada con código.
//
// Las señales se piden al modelo ANTES de visitar el sitio y solo a partir
// del objetivo (PROMPTS.goalSignals): la página no puede influir en ellas.
// Al terminar una ruta, el código las busca en la página final. Si el
// modelo dice que llegó pero ninguna señal aparece, la ruta queda sin
// verificar (UNVERIFIED) y no puede ser la recomendada.
//
// Módulo sin dependencias de runtime (solo tipos): los tests lo cargan con
// `node --test`.

export interface GoalSignals {
  // Textos visibles que aparecen cuando el objetivo se cumplió.
  text: string[];
  // Fragmentos de ruta de la URL donde suele cumplirse ("/pricing").
  url: string[];
}

export const NO_SIGNALS: GoalSignals = { text: [], url: [] };

const MAX_TEXT_SIGNALS = 8;
const MAX_URL_HINTS = 5;
const MAX_SIGNAL = 40;

const normalize = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
const occurrences = (text: string, needle: string) => (needle ? text.split(needle).length - 1 : 0);

// La respuesta del modelo en forma válida: strings cortos, sin vacíos ni
// repetidos.
export function normalizeSignals(raw: unknown): GoalSignals {
  const list = (value: unknown, max: number) =>
    Array.isArray(value)
      ? [
          ...new Set(
            value
              .filter((x): x is string => typeof x === "string")
              .map((x) => normalize(x).slice(0, MAX_SIGNAL))
              .filter((x) => x.length >= 2)
          ),
        ].slice(0, max)
      : [];
  const r = (raw ?? {}) as { textSignals?: unknown; urlHints?: unknown };
  return { text: list(r.textSignals, MAX_TEXT_SIGNALS), url: list(r.urlHints, MAX_URL_HINTS) };
}

export interface GoalEvidence {
  verified: boolean;
  found: string[];
}

// La página final cumple el objetivo si su URL tiene una de las pistas, o
// si una señal de texto aparece más veces que en la página de inicio ("Pricing" está en la
// cabecera de todas las páginas y no prueba nada por estar).
export function checkGoalEvidence(
  signals: GoalSignals,
  initialText: string,
  finalText: string,
  finalUrl: string
): GoalEvidence {
  const before = normalize(initialText);
  const after = normalize(finalText);
  let path = "";
  try {
    const url = new URL(finalUrl);
    path = `${url.pathname}${url.search}`.toLowerCase();
  } catch {
    // Sin URL legible solo cuentan las señales de texto.
  }
  const found = [
    ...signals.url.filter((hint) => path.includes(hint)),
    ...signals.text.filter((signal) => occurrences(after, signal) > occurrences(before, signal)),
  ];
  return { verified: found.length > 0, found };
}

// La recomendada solo puede ser una ruta ejecutada, que llegó y cuya
// llegada se comprobó. Lo que proponga el comparador se ignora si no lo es.
export function pickBestRouteId(
  routes: Pick<Route, "id" | "verified" | "outcome" | "goalVerified">[],
  proposedId: string | null | undefined
): string | null {
  const best = routes.find((r) => r.id === proposedId);
  return best && best.verified && best.outcome === "reached" && best.goalVerified === true ? best.id : null;
}
