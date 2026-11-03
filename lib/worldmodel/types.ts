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
// USER PROFILE: tipo de usuario simulado
// ============================================================
export type UserProfile = "new" | "returning" | "rushed" | "explorer";

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