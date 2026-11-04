import { Type, type Schema } from "@google/genai";
import { ALLOWED_KEYS, STEP_TYPES, TARGET_TYPES } from "../worldmodel/step-guard";

// Enums bound what an injection can do with the output. Code still re-validates (step-guard.ts):
// the schema narrows, it doesn't replace.

const STEP: Schema = {
  type: Type.OBJECT,
  properties: {
    order: { type: Type.INTEGER },
    type: { type: Type.STRING, enum: [...STEP_TYPES] },
    description: { type: Type.STRING },
    targetElement: { type: Type.STRING },
    targetType: { type: Type.STRING, enum: [...TARGET_TYPES] },
    value: { type: Type.STRING, description: `Text to type, or for "press" one of: ${ALLOWED_KEYS.join(", ")}` },
    navigationExpected: { type: Type.STRING, enum: ["navigate", "same-page", "unknown"] },
    expectedUrlHint: { type: Type.STRING, nullable: true },
    expectedSignals: { type: Type.ARRAY, maxItems: "3", items: { type: Type.STRING } },
  },
  required: ["order", "type", "description", "targetElement", "targetType", "navigationExpected", "expectedSignals"],
  propertyOrdering: [
    "order", "type", "description", "targetElement", "targetType", "value",
    "navigationExpected", "expectedUrlHint", "expectedSignals",
  ],
};

export const ROUTES_SCHEMA: Schema = {
  type: Type.ARRAY,
  maxItems: "5",
  items: {
    type: Type.OBJECT,
    properties: {
      id: { type: Type.STRING },
      name: { type: Type.STRING },
      entryPoint: { type: Type.STRING },
      entryType: { type: Type.STRING, enum: [...TARGET_TYPES] },
      entryDescription: { type: Type.STRING },
      howUsersFindIt: { type: Type.STRING },
      endState: { type: Type.STRING },
      goalLink: { type: Type.STRING },
      servesGoal: { type: Type.BOOLEAN },
      meetsCriteria: { type: Type.BOOLEAN },
      probability: { type: Type.NUMBER },
    },
    required: [
      "id", "name", "entryPoint", "entryType", "entryDescription", "howUsersFindIt",
      "endState", "goalLink", "servesGoal", "meetsCriteria", "probability",
    ],
    propertyOrdering: [
      "id", "name", "entryPoint", "entryType", "entryDescription", "howUsersFindIt",
      "endState", "goalLink", "servesGoal", "meetsCriteria", "probability",
    ],
  },
};

export const DREAM_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    steps: { type: Type.ARRAY, maxItems: "6", items: STEP },
    predictedFriction: { type: Type.NUMBER },
    frictionReason: { type: Type.STRING },
    predictedOutcome: { type: Type.STRING },
    reachesGoal: { type: Type.BOOLEAN },
  },
  required: ["steps", "predictedFriction", "frictionReason", "predictedOutcome", "reachesGoal"],
  propertyOrdering: ["steps", "predictedFriction", "frictionReason", "predictedOutcome", "reachesGoal"],
};

export const REDREAM_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    goalAlreadyMet: { type: Type.BOOLEAN },
    steps: { type: Type.ARRAY, maxItems: "5", items: STEP },
  },
  required: ["goalAlreadyMet", "steps"],
  propertyOrdering: ["goalAlreadyMet", "steps"],
};

export const COMPARE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    bestRouteId: { type: Type.STRING, nullable: true },
    mostLikelyRouteId: { type: Type.STRING, nullable: true },
    verdict: { type: Type.STRING },
    recommendation: { type: Type.STRING },
  },
  required: ["bestRouteId", "mostLikelyRouteId", "verdict", "recommendation"],
  propertyOrdering: ["bestRouteId", "mostLikelyRouteId", "verdict", "recommendation"],
};

export const PERSONA_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    label: { type: Type.STRING },
    description: { type: Type.STRING },
    traits: { type: Type.ARRAY, maxItems: "5", items: { type: Type.STRING } },
    patience: { type: Type.STRING, enum: ["low", "medium", "high"] },
    techSavvy: { type: Type.STRING, enum: ["low", "medium", "high"] },
  },
  required: ["label", "description", "traits", "patience", "techSavvy"],
  propertyOrdering: ["label", "description", "traits", "patience", "techSavvy"],
};

export const GOAL_SIGNALS_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    textSignals: { type: Type.ARRAY, maxItems: "8", items: { type: Type.STRING } },
    urlHints: { type: Type.ARRAY, maxItems: "5", items: { type: Type.STRING } },
  },
  required: ["textSignals", "urlHints"],
  propertyOrdering: ["textSignals", "urlHints"],
};
