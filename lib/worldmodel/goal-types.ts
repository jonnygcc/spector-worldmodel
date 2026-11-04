import { InteractiveElement, PageState } from "./types";
import type { GoalSignals } from "./goal-evidence";

// ============================================================
// GOALS: que quiere lograr el usuario en el sitio
// ============================================================
export type GoalId =
  | "signup"
  | "purchase"
  | "find_info"
  | "contact"
  | "explore"
  | "general_scan";

export interface Goal {
  // "custom": objetivo escrito por el usuario (goalFromText).
  id: GoalId | "custom";
  label: string;
  description: string;
  successCriteria: string;
}

export const GOALS: Record<GoalId, Goal> = {
  signup: {
    id: "signup",
    label: "Sign up / Create account",
    description: "The user wants to register and create a new account on the site.",
    successCriteria:
      "The user reaches a registration form, a sign-up page, or an account creation flow.",
  },
  purchase: {
    id: "purchase",
    label: "Buy something",
    description: "The user wants to find a product and start the purchase process.",
    successCriteria:
      "The user reaches a product page, adds something to a cart, or reaches a checkout flow.",
  },
  find_info: {
    id: "find_info",
    label: "Find information",
    description:
      "The user is looking for specific information: pricing, features, documentation, or answers.",
    successCriteria:
      "The user reaches a page that contains the information they were looking for.",
  },
  contact: {
    id: "contact",
    label: "Contact support",
    description: "The user needs help and wants to reach a human or a support channel.",
    successCriteria:
      "The user reaches a contact form, support page, chat widget, or finds contact details.",
  },
  explore: {
    id: "explore",
    label: "Explore the product",
    description:
      "The user wants to understand what the product does before committing to anything.",
    successCriteria:
      "The user reaches content that explains the product: features, demo, tour, or use cases.",
  },
  general_scan: {
    id: "general_scan",
    label: "General scan",
    description:
      "No specific goal. Explore the most likely actions users would take on this page.",
    successCriteria: "N/A — this mode explores broadly instead of targeting one outcome.",
  },
};

// ============================================================
// PERSONAS: quien es el usuario que recorre el sitio
// ============================================================
export type PersonaMode = "automatic" | "personal";

export interface Persona {
  id: string;
  label: string;
  description: string;
  traits: string[];
  patience: "low" | "medium" | "high";
  techSavvy: "low" | "medium" | "high";
}

export const AUTO_PERSONAS: Persona[] = [
  {
    id: "rushed",
    label: "In a hurry",
    description:
      "Wants to complete the task as fast as possible. Scans instead of reading. Abandons quickly if confused.",
    traits: ["impatient", "goal-oriented", "skims content"],
    patience: "low",
    techSavvy: "medium",
  },
  {
    id: "first_timer",
    label: "First-time visitor",
    description:
      "Has never seen this site before. Needs orientation. Unsure what each element does.",
    traits: ["cautious", "needs context", "reads labels carefully"],
    patience: "medium",
    techSavvy: "medium",
  },
  {
    id: "skeptical",
    label: "Cautious and skeptical",
    description:
      "Worries about privacy, pricing surprises and commitment. Looks for proof before acting.",
    traits: ["reads fine print", "looks for pricing", "avoids giving data"],
    patience: "high",
    techSavvy: "medium",
  },
  {
    id: "non_technical",
    label: "Not very tech-savvy",
    description:
      "Gets lost with jargon, icon-only buttons and multi-step flows. Needs plain language.",
    traits: ["confused by jargon", "needs explicit labels", "avoids experimentation"],
    patience: "medium",
    techSavvy: "low",
  },
  {
    id: "returning",
    label: "Returning user",
    description:
      "Knows the site. Goes straight for what they need. Expects things to be where they remember.",
    traits: ["efficient", "uses shortcuts", "expects consistency"],
    patience: "medium",
    techSavvy: "high",
  },
];

export interface PersonaSelection {
  mode: PersonaMode;
  customDescription?: string;
  resolved: Persona;
}

// Objetivo escrito por el usuario en la barra. El texto es el objetivo tal
// cual: los prompts lo reciben como descripción y criterio de éxito.
export function goalFromText(text: string): Goal {
  const goal = text.trim();
  return {
    id: "custom",
    label: goal,
    description: `The user wants to: ${goal}`,
    successCriteria: `The user reaches the page, form or flow where they can complete this: ${goal}`,
  };
}

export function pickAutoPersona(goalId: GoalId | "custom"): Persona {
  const map: Record<GoalId | "custom", string> = {
    custom: "first_timer",
    signup: "first_timer",
    purchase: "rushed",
    find_info: "rushed",
    contact: "non_technical",
    explore: "first_timer",
    general_scan: "first_timer",
  };
  const id = map[goalId];
  return AUTO_PERSONAS.find((p) => p.id === id) || AUTO_PERSONAS[1];
}

// ============================================================
// ROUTES: los distintos caminos hacia un mismo objetivo
// ============================================================
// Qué debería pasar con la URL tras la acción de un paso.
export type NavigationExpectation = "same-page" | "navigate" | "unknown";

export interface RouteStep {
  order: number;
  type: "click" | "type" | "press" | "scroll";
  description: string;
  targetElement: string;
  targetType: InteractiveElement["type"];
  value?: string;
  // Expectativa verificable sin el modelo, emitida por el dreamer.
  navigationExpected?: NavigationExpectation;
  // Fragmento de ruta esperado tras la acción ("/cart", "/products/"), o null.
  expectedUrlHint?: string | null;
  // 1 a 3 textos que deberían aparecer en la página tras la acción.
  expectedSignals?: string[];
}

// Resultado de comprobar la expectativa de un paso contra la página real.
export type StepCheck = "match" | "partial" | "diverged";

// Comparación predicho/real de un paso ejecutado (o intentado).
export interface RouteStepResult {
  // El paso que se intentó, tal como estaba en el plan en ese momento (el
  // inicial o el de un re-sueño).
  step: RouteStep;
  // Plan del que salió el paso: 0 = el sueño inicial, 1 y 2 = re-sueños.
  plan: number;
  // Elemento que se encontró para el targetElement, y su puntaje de
  // emparejamiento (0–1). null si no se encontró ninguno.
  found: { label: string; score: number } | null;
  // Otros candidatos con puntaje parecido al elegido: si los hay, el paso
  // era ambiguo y se re-soñó sin actuar.
  rivals?: { label: string; score: number }[];
  executed: boolean;
  stateChanged: boolean;
  // Comprobaciones tras la acción y su veredicto.
  check: StepCheck;
  checks: {
    urlChanged: boolean;
    urlAsExpected: boolean | null; // null: la expectativa era "unknown"
    urlHintMatched: boolean | null; // null: no había pista
    signalsFound: string[];
    signalsMissing: string[];
    nextElementFound: boolean | null; // null: era el último paso
  };
  actualUrl: string;
  actualTitle: string;
  screenshot: string;
  realFriction: number;
  whatHappened: string;
  // Este paso disparó un re-sueño: antes de actuar (elemento dudoso o
  // ambiguo) o después (la página no hizo lo esperado).
  redream?: "before-action" | "after-action";
  // Tropiezo del motor, no paso del sitio: se guarda y se muestra en la
  // tira, pero no suma a pasos, tiempo ni fricción.
  discarded?: boolean;
}

// Cómo terminó una ruta ejecutada.
// - reached: llegó al objetivo.
// - blocked: el sitio la detuvo (login, pago, protección anti-bots).
// - unreachable: no encontró camino tras replanificar.
export type RouteOutcome = "reached" | "blocked" | "unreachable";

export interface Route {
  id: string;
  // Nombre en inglés para mostrar; entryPoint es la etiqueta literal del
  // elemento, en el idioma del sitio.
  name?: string;
  entryPoint: string;
  entryDescription: string;
  howUsersFindIt: string;
  probability: number;
  predictedSteps: RouteStep[];
  predictedFriction: number;
  frictionReason: string;
  predictedOutcome: string;
  verified: boolean;
  stepResults?: RouteStepResult[];
  realFriction?: number;
  reachedGoal?: boolean;
  outcome?: RouteOutcome;
  // Si el navegador tuvo que re-soñar la ruta desde la página real.
  replanned?: boolean;
  replanCount?: number;
  // De esos re-sueños, cuántos se dispararon antes de actuar.
  replansBeforeAction?: number;
  // Pasos del camino que llevó al objetivo (sin los descartados).
  pathSteps?: number;
  // La probabilidad del finder describía el camino del plan inicial; si
  // se replanificó, el camino recorrido es otro y queda como estimada.
  probabilityEstimated?: boolean;
  // Solo en rutas "reached": si el código encontró en la página final las
  // señales del objetivo (goal-evidence.ts). Sin esa evidencia la ruta es
  // UNVERIFIED y no puede ser la recomendada.
  goalVerified?: boolean;
  goalSignalsFound?: string[];
  verdict?: string;
}

// ============================================================
// RESULT: el reporte comparativo final
// ============================================================
export interface RouteComparison {
  url: string;
  goal: Goal;
  persona: Persona;
  personaMode: PersonaMode;
  initialState: PageState;
  routes: Route[];
  // Rutas que propuso el finder y sobrevivieron al filtro del criterio de
  // éxito (de ellas se ejecuta un subconjunto en el navegador).
  routesFound?: number;
  // Señales del objetivo, pedidas antes de visitar el sitio.
  goalSignals?: GoalSignals;
  bestRouteId: string | null;
  mostLikelyRouteId: string | null;
  verdict: string;
  recommendation: string;
}