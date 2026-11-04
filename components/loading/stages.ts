import {
  GitCompare,
  Globe,
  MonitorPlay,
  Route,
  UserRoundCheck,
  Waypoints,
  type LucideIcon,
} from "lucide-react";

// Separate module (no "use client") so server components like the /loading preview can read the ids.
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
