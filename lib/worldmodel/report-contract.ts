// Contrato de datos del reporte: lo que un motor tiene que rellenar para
// que una sección se dibuje. Vive en lib/ para que el motor del World
// Model lo produzca sin depender de la UI; components/report/contract.ts
// lo reexporta junto al adaptador a la tabla.

export interface StepNode {
  index: number;
  label: string;
  screenshot?: string; // solo en Agent
}

export type RouteStatus = "recommended" | "executed" | "blocked" | "success" | "friction";

export interface RouteRow {
  user: string; // agent: ruta/persona | world model: nombre del escenario
  subtitle?: string; // world model: tipo ("Alternative route", etc.)
  time: string;
  probability: number; // 0–100
  steps: number;
  friction: number; // 0–100
  status: RouteStatus;
  estimated?: boolean; // world model: "~" en time/steps
  // Cuántos pasos se alcanzaron (en orden de index). Los de antes van en
  // azul en el timeline; desde ahí, neutral-200. Sin él, todos alcanzados
  // salvo en BLOCKED, donde se corta en el primer paso que falló.
  reachedSteps?: number;
  stepNodes: StepNode[];
}

// Escenario del World Model: predicción, sin Time ni capturas (en la
// tabla va siempre como estimated).
export type WMKind = "Alternative route" | "User error" | "UI confusion" | "Flow block";

export interface WMScenario {
  user: string;
  subtitle: WMKind;
  probability: number; // 0-100
  steps: number;
  friction: number; // 0-100
  status: "success" | "friction" | "blocked";
  // Pasos alcanzados: = steps en success/friction; < steps en blocked.
  reachedSteps: number;
  // Una frase para el diseñador, nombrando el elemento concreto.
  recommendation: string;
  stepNodes: StepNode[]; // sin screenshot
}

export interface ReportSection {
  mode: "agent" | "world-model";
  meta: string;
  rows: RouteRow[];
}
