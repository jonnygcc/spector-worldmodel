import type { WMScenario } from "@/lib/worldmodel/report-contract";

// SAMPLE — fixed scenarios for the /report preview; the real analysis uses the engine's.
export const WORLD_MODEL_SAMPLE: WMScenario[] = [
  {
    user: "Can't spot Sign up, searches Google",
    subtitle: "Alternative route",
    probability: 34,
    steps: 5,
    friction: 40,
    status: "success",
    reachedSteps: 5,
    recommendation: "Raise the contrast of the top-right Sign up button so it reads as the primary action.",
    stepNodes: [
      { index: 1, label: "Miss the top-right CTA" },
      { index: 2, label: "Leave to Google" },
      { index: 3, label: "Search “Linear sign up”" },
      { index: 4, label: "Open the top result" },
      { index: 5, label: "Land back on sign up" },
    ],
  },
  {
    user: "Enters a personal email",
    subtitle: "User error",
    probability: 41,
    steps: 7,
    friction: 62,
    status: "friction",
    reachedSteps: 5,
    recommendation: "Say “Use your work email” in the sign-up email field before the user submits it.",
    stepNodes: [
      { index: 1, label: "Start sign up" },
      { index: 2, label: "Enter a personal email" },
      { index: 3, label: "Set a password" },
      { index: 4, label: "Hit the work-email error" },
      { index: 5, label: "Restart the form" },
    ],
  },
  {
    user: "Work email needs SSO approval",
    subtitle: "Flow block",
    probability: 18,
    steps: 4,
    friction: 78,
    status: "blocked",
    recommendation: "Offer an email sign-up option on the SSO redirect screen for users without admin approval.",
    // 01–03 are reached; 04 is where it blocks.
    reachedSteps: 3,
    stepNodes: [
      { index: 1, label: "Start sign up" },
      { index: 2, label: "Enter the work email" },
      { index: 3, label: "Redirected to SSO" },
      { index: 4, label: "Blocked: needs admin approval" },
    ],
  },
];
