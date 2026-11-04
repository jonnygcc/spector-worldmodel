import { InteractiveElement, PageState } from "./types";
import type { GoalSignals } from "./goal-evidence";

// ---- Goals: what the user wants to achieve on the site ----
export type GoalId =
  | "signup"
  | "purchase"
  | "find_info"
  | "contact"
  | "explore"
  | "general_scan";

export interface Goal {
  // "custom": a goal typed by the user (goalFromText).
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

// ---- Personas: who is browsing the site ----
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

// The text is the goal as typed: prompts get it as both description and success criteria.
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

// ---- Routes: the different paths toward the same goal ----
// What should happen to the URL after a step's action.
export type NavigationExpectation = "same-page" | "navigate" | "unknown";

export interface RouteStep {
  order: number;
  type: "click" | "type" | "press" | "scroll";
  description: string;
  targetElement: string;
  targetType: InteractiveElement["type"];
  value?: string;
  // An expectation checkable without the model, emitted by the dreamer.
  navigationExpected?: NavigationExpectation;
  // Expected path fragment after the action ("/cart", "/products/"), or null.
  expectedUrlHint?: string | null;
  // 1 to 3 texts that should appear on the page after the action.
  expectedSignals?: string[];
}

export type StepCheck = "match" | "partial" | "diverged";

// Predicted vs. actual for an executed (or attempted) step.
export interface RouteStepResult {
  // The step as it was in the plan at that moment (the initial one or a re-plan's).
  step: RouteStep;
  // Plan the step came from: 0 = initial dream, 1 and 2 = re-plans.
  plan: number;
  // Element found for targetElement and its match score (0–1); null if none.
  found: { label: string; score: number } | null;
  // Other candidates scoring close to the chosen one: the step was ambiguous and re-planned without acting.
  rivals?: { label: string; score: number }[];
  executed: boolean;
  stateChanged: boolean;
  check: StepCheck;
  checks: {
    urlChanged: boolean;
    urlAsExpected: boolean | null; // null: the expectation was "unknown"
    urlHintMatched: boolean | null; // null: there was no hint
    signalsFound: string[];
    signalsMissing: string[];
    nextElementFound: boolean | null; // null: it was the last step
  };
  actualUrl: string;
  actualTitle: string;
  screenshot: string;
  realFriction: number;
  whatHappened: string;
  // This step triggered a re-plan: before acting (doubtful or ambiguous element) or after (unexpected page).
  redream?: "before-action" | "after-action";
  // An engine stumble, not a site step: kept and shown in the strip, but not counted in steps, time or friction.
  discarded?: boolean;
}

// reached: arrived. blocked: stopped by the site (login, payment, bot check). unreachable: no path
// after re-planning.
export type RouteOutcome = "reached" | "blocked" | "unreachable";

export interface Route {
  id: string;
  // English display name; entryPoint is the element's literal label, in the site's language.
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
  // Whether the browser had to re-plan the route from the real page.
  replanned?: boolean;
  replanCount?: number;
  // How many of those re-plans fired before acting.
  replansBeforeAction?: number;
  // Steps of the path that reached the goal, discarded ones excluded.
  pathSteps?: number;
  // The finder's probability described the initial plan; after a re-plan the walked path differs, so
  // it's marked as estimated.
  probabilityEstimated?: boolean;
  // Only on "reached" routes: whether code found the goal signals on the final page. Without them the
  // route is UNVERIFIED and can't be recommended.
  goalVerified?: boolean;
  goalSignalsFound?: string[];
  verdict?: string;
}

// ---- Result: the final comparison report ----
export interface RouteComparison {
  url: string;
  goal: Goal;
  persona: Persona;
  personaMode: PersonaMode;
  initialState: PageState;
  routes: Route[];
  // Routes the finder proposed that passed the success-criteria filter (a subset runs in the browser).
  routesFound?: number;
  // Goal signals, derived before visiting the site.
  goalSignals?: GoalSignals;
  bestRouteId: string | null;
  mostLikelyRouteId: string | null;
  verdict: string;
  recommendation: string;
}