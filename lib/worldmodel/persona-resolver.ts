import {
  Persona,
  PersonaMode,
  PersonaSelection,
  GoalId,
  AUTO_PERSONAS,
  pickAutoPersona,
} from "./goal-types";
import { askGemini, cleanJsonResponse } from "../llm/gemini";
import { PROMPTS } from "../llm/prompts";

async function buildPersonaFromDescription(description: string): Promise<Persona> {
  const prompt = PROMPTS.buildPersona.replace("{DESCRIPTION}", description);

  const response = await askGemini(prompt);
  const cleaned = cleanJsonResponse(response);

  try {
    const parsed = JSON.parse(cleaned) as {
      label: string;
      description: string;
      traits: string[];
      patience: "low" | "medium" | "high";
      techSavvy: "low" | "medium" | "high";
    };

    return {
      id: "custom",
      label: parsed.label || "Custom persona",
      description: parsed.description || description,
      traits: Array.isArray(parsed.traits) ? parsed.traits.slice(0, 5) : [],
      patience: parsed.patience || "medium",
      techSavvy: parsed.techSavvy || "medium",
    };
  } catch {
    // Fallback: usamos la descripcion cruda del usuario
    return {
      id: "custom",
      label: "Custom persona",
      description,
      traits: [],
      patience: "medium",
      techSavvy: "medium",
    };
  }
}

export async function resolvePersona(
  mode: PersonaMode,
  goalId: GoalId | "custom",
  customDescription?: string
): Promise<PersonaSelection> {
  if (mode === "personal" && customDescription && customDescription.trim().length > 10) {
    const resolved = await buildPersonaFromDescription(customDescription.trim());
    return {
      mode: "personal",
      customDescription: customDescription.trim(),
      resolved,
    };
  }

  // Modo automatico: elegimos el arquetipo que mejor encaja con el objetivo
  return {
    mode: "automatic",
    resolved: pickAutoPersona(goalId),
  };
}

export function describePersonaForPrompt(persona: Persona): string {
  const traits =
    persona.traits.length > 0 ? ` Behavioral traits: ${persona.traits.join(", ")}.` : "";
  return `${persona.label} — ${persona.description}${traits} Patience level: ${persona.patience}. Technical skill: ${persona.techSavvy}.`;
}

export function listAutoPersonas(): Persona[] {
  return AUTO_PERSONAS;
}