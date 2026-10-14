import { InteractiveElement, PageState, UserProfile } from "./types";

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
  id: GoalId;
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

export function buildCustomPersona(description: string): Persona {
  return {
    id: "custom",
    label: "Custom persona",
    description,
    traits: [],
    patience: "medium",
    techSavvy: "medium",
  };
}

export function pickAutoPersona(goalId: GoalId): Persona {
  const map: Record<GoalId, string> = {
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
export interface RouteStep {
  order: number;
  type: "click" | "type" | "press" | "scroll";
  description: string;
  targetElement: string;
  targetType: InteractiveElement["type"];
  value?: string;
}

export interface RouteStepResult {
  executed: boolean;
  stateChanged: boolean;
  actualUrl: string;
  actualTitle: string;
  screenshot: string;
  realFriction: number;
  whatHappened: string;
}

export interface Route {
  id: string;
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
  bestRouteId: string | null;
  mostLikelyRouteId: string | null;
  verdict: string;
  recommendation: string;
}

// Compatibilidad con el perfil de usuario existente
export function personaToUserProfile(persona: Persona): UserProfile {
  if (persona.id === "rushed") return "rushed";
  if (persona.id === "returning") return "returning";
  if (persona.id === "first_timer" || persona.id === "non_technical") return "new";
  return "explorer";
}