import {
  GitCompare,
  Globe,
  MonitorPlay,
  Route,
  UserRoundCheck,
  Waypoints,
  type LucideIcon,
} from "lucide-react";

// Etapas del motor, en orden. Módulo aparte (sin "use client") para que
// los componentes de servidor, como la preview /loading, puedan leer los
// ids: los valores que exporta un módulo de cliente no se pueden usar en
// el servidor.
export type StageId =
  | "load"
  | "profiles"
  | "find"
  | "simulate"
  | "browser"
  | "compare";

export const STAGES: { id: StageId; label: string; Icon: LucideIcon }[] = [
  { id: "load", label: "Loading the site", Icon: Globe },
  { id: "profiles", label: "Choosing profiles", Icon: UserRoundCheck },
  { id: "find", label: "Finding routes", Icon: Route },
  { id: "simulate", label: "Simulating routes", Icon: Waypoints },
  { id: "browser", label: "Running in a real browser", Icon: MonitorPlay },
  { id: "compare", label: "Comparing routes", Icon: GitCompare },
];

export const STAGE_IDS: StageId[] = STAGES.map((s) => s.id);
