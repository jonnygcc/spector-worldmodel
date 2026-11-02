// ============================================================
// STATE: lo que Spector observa de la pagina
// ============================================================
export interface InteractiveElement {
  type: "button" | "link" | "input" | "form" | "menu";
  label: string;
  selector: string;
  coordinates: { x: number; y: number };
  // "chrome": dentro de header, nav o footer; "content": el resto.
  region?: "chrome" | "content";
}

export interface PageState {
  url: string;
  title: string;
  metaDescription: string;
  headings: string[];
  interactiveElements: InteractiveElement[];
  screenshot: string;
}

// ============================================================
// ACTION: lo que un usuario podria hacer
// ============================================================
export type UserProfile = "new" | "returning" | "rushed" | "explorer";

export interface Action {
  id: string;
  description: string;
  targetElement: string;
  targetType: InteractiveElement["type"];
  userProfile: UserProfile;
  probability: number;
}

// ============================================================
// PREDICTION: lo que el world model imagina que pasaria
// ============================================================
export interface Prediction {
  actionId: string;
  imaginedState: string;
  predictedFriction: number;
  frictionReason: string;
  extraStepsNeeded: number;
  confidence: number;
}

// ============================================================
// VERIFICATION: lo que realmente pasa cuando ejecutamos la accion
// ============================================================
export interface Verification {
  actionId: string;
  actualState: PageState;
  predictionMatch: number;
  realFriction: number;
  discrepancy: string;
}

// ============================================================
// JOURNEY NODE: nodo del arbol de escenarios
// ============================================================
export interface JourneyNode {
  depth: number;
  state: PageState;
  action: Action;
  prediction: Prediction;
  verification?: Verification;
  children: JourneyNode[];
}

// ============================================================
// FINDING: hallazgo final presentado al usuario
// ============================================================
export interface Finding {
  title: string;
  description: string;
  severity: "high" | "medium" | "low";
  step: string;
  evidence: {
    predictedFriction: number;
    realFriction: number;
    screenshot?: string;
    userProfile: UserProfile;
  };
}

// ============================================================
// JOURNEY REPORT: resultado completo del world model
// ============================================================
export interface JourneyReport {
  url: string;
  uxScore: number;
  verdict: string;
  findings: Finding[];
  journeyTree: JourneyNode[];
  explorationStats: {
    actionsConsidered: number;
    actionsPredicted: number;
    actionsVerified: number;
  };
}

// ============================================================
// WHAT-IF: journeys multi-paso encadenados
// ============================================================

export type StepActionType = "click" | "type" | "press" | "scroll";

export interface StepAction {
  order: number;
  type: StepActionType;
  description: string;
  targetElement: string;
  targetType: InteractiveElement["type"];
  value?: string;
}

export interface StepPrediction {
  imaginedState: string;
  predictedFriction: number;
  frictionReason: string;
  confidence: number;
}

export interface StepVerification {
  executed: boolean;
  stateChanged: boolean;
  actualUrl: string;
  actualTitle: string;
  screenshot: string;
  predictionMatch: number;
  realFriction: number;
  discrepancy: string;
}

export interface WhatIfStep {
  action: StepAction;
  prediction: StepPrediction;
  verification?: StepVerification;
}

export interface WhatIfJourney {
  url: string;
  question: string;
  intent: string;
  userProfile: UserProfile;
  steps: WhatIfStep[];
  outcome: "completed" | "blocked" | "partial";
  summary: string;
  truncated: boolean;
}