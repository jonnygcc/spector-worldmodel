// Datos de ejemplo del frame Desktop/Reporte. Fijos: el motor no está
// conectado. Lo que el frame no trae está marcado como "no está en el frame".

// UNREACHABLE: la ruta se ejecutó pero no encontró camino al objetivo ni
// tras replanificar. SUCCESS y FRICTION solo existen en el World Model:
// escenarios predichos, que nunca se ejecutan (BLOCKED vale para los dos).
export type Status = "recommended" | "executed" | "blocked" | "unreachable" | "success" | "friction";
export type Friction = "low" | "medium" | "high";

// `screenshot` solo existe en rutas verificadas en el navegador; sin ella
// la captura muestra el esqueleto de página. `unreached`: el paso queda en o después del punto donde la ruta se
// detuvo; lo calcula withReach (pathSteps.ts), no se escribe a mano.
export type Step = {
  label: string;
  failed?: boolean;
  unreached?: boolean;
  screenshot?: string;
};

export type Route = {
  user: string;
  // World Model: tipo de escenario, en gris bajo el nombre.
  subtitle?: string;
  time: string;
  probability: string;
  friction: { value: number; level: Friction };
  // Sin estado solo en datos antiguos; las rutas del motor siempre lo traen.
  status?: Status;
  // Escenario predicho por el World Model, no ejecutado: time y steps con
  // "~", barra de fricción punteada y pasos sin captura.
  estimated?: boolean;
  // Pasos que dice la fila cuando no coinciden con los dibujados (un
  // escenario predicho estima más pasos de los que detalla). Sin él, la
  // columna cuenta `steps` (sin los replanificados).
  stepCount?: number;
  // Cuántos pasos (por posición en `steps`) se alcanzaron. Sin él: todos
  // en una ruta completada; en una BLOCKED o UNREACHABLE, hasta el primer
  // paso que falló.
  reachedSteps?: number;
  // World Model: qué cambiar, en una frase. Va en una card bajo el timeline.
  recommendation?: string;
  steps: Step[];
};

export const REPORT = {
  url: "https://linear.app",
  goal: "Sign up for a team plan",
  date: "Oct 16, 2026",
  executed: 3,
  profiles: 2,
  model: "GPT-5.5",
};

export const ROUTES: Route[] = [
  {
    user: "First-time team admin",
    time: "0:42",
    probability: "31%",
    friction: { value: 21, level: "low" },
    status: "recommended",
    steps: [
      { label: "Open linear.app" },
      { label: "Click “Pricing” in the header" },
      { label: "Choose the Business plan" },
      { label: "Enter a work email" },
      { label: "Name the workspace" },
      // No está en el frame: la fila dice 6 pasos y el frame dibuja 5.
      { label: "Confirm the team plan" },
    ],
  },
  {
    user: "Owner on an old phone",
    time: "1:05",
    probability: "44%",
    friction: { value: 48, level: "medium" },
    status: "executed",
    // No está en el frame: esta fila no se dibuja expandida.
    steps: [
      { label: "Open linear.app" },
      { label: "Open the menu" },
      { label: "Tap “Pricing”" },
      { label: "Scroll to the plans" },
      { label: "Choose the Business plan" },
      { label: "Enter a work email" },
      { label: "Verify the email" },
      { label: "Name the workspace" },
      { label: "Confirm the team plan" },
    ],
  },
  {
    user: "First-time team admin",
    time: "0:58",
    probability: "12%",
    friction: { value: 67, level: "high" },
    status: "blocked",
    // Frame Reporte – blocked. Tres pasos: la columna STEPS y la secuencia
    // dicen lo mismo (el frame decía 11 en la columna).
    steps: [
      { label: "Open linear.app" },
      { label: "Click “Pricing” in the header" },
      { label: "Choose the Business plan", failed: true },
    ],
  },
];

