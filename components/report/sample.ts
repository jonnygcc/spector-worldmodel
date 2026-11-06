// Fixed sample data from the Desktop/Report frame; anything the frame lacks is marked as such.

// SUCCESS and FRICTION only exist in the World Model (never executed); BLOCKED applies to both.
// "unverified" is missing evidence, not an outcome: the plan ended but the goal signals weren't found.
// "continues" isn't a failure: the flow went where Spector can't follow.
export type Status =
  | "recommended"
  | "executed"
  | "blocked"
  | "unreachable"
  | "success"
  | "friction"
  | "unverified"
  | "continues";
export type Friction = "low" | "medium" | "high";

// `screenshot` only exists on browser-verified routes. `unreached` is computed by withReach
// (pathSteps.ts), never written by hand.
export type Step = {
  label: string;
  failed?: boolean;
  unreached?: boolean;
  screenshot?: string;
};

export type Route = {
  user: string;
  // World Model: scenario kind. Agent: where a "continues" route went. Shown in gray under the name.
  subtitle?: string;
  time: string;
  probability: string;
  friction: { value: number; level: Friction };
  // Missing only in old data; engine routes always have it.
  status?: Status;
  // Predicted by the World Model, never executed: "~" on time and steps, no screenshots.
  estimated?: boolean;
  // Step count shown when it differs from the drawn steps (a prediction may estimate more than it details).
  stepCount?: number;
  // Reached steps, by position. Without it: all of them on a completed route, else up to the first failure.
  reachedSteps?: number;
  // World Model: what to change, in one sentence; shown in a card under the timeline.
  recommendation?: string;
  steps: Step[];
};

export const REPORT = {
  url: "https://linear.app",
  goal: "Sign up for a team plan",
  date: "Oct 16, 2026",
  executed: 3,
  profiles: 2,
  model: "GPT-5.5",
};

export const ROUTES: Route[] = [
  {
    user: "First-time team admin",
    time: "0:42",
    probability: "31%",
    friction: { value: 21, level: "low" },
    status: "recommended",
    steps: [
      { label: "Open linear.app" },
      { label: "Click “Pricing” in the header" },
      { label: "Choose the Business plan" },
      { label: "Enter a work email" },
      { label: "Name the workspace" },
      // Not in the frame: the row says 6 steps and the frame draws 5.
      { label: "Confirm the team plan" },
    ],
  },
  {
    user: "Owner on an old phone",
    time: "1:05",
    probability: "44%",
    friction: { value: 48, level: "medium" },
    status: "executed",
    // Not in the frame: this row is never drawn expanded.
    steps: [
      { label: "Open linear.app" },
      { label: "Open the menu" },
      { label: "Tap “Pricing”" },
      { label: "Scroll to the plans" },
      { label: "Choose the Business plan" },
      { label: "Enter a work email" },
      { label: "Verify the email" },
      { label: "Name the workspace" },
      { label: "Confirm the team plan" },
    ],
  },
  {
    user: "First-time team admin",
    time: "0:58",
    probability: "12%",
    friction: { value: 67, level: "high" },
    status: "blocked",
    // Blocked report frame: STEPS and the sequence agree on three (the frame said 11).
    steps: [
      { label: "Open linear.app" },
      { label: "Click “Pricing” in the header" },
      { label: "Choose the Business plan", failed: true },
    ],
  },
];

