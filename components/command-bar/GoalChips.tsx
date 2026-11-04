"use client";

import GoalChip from "./GoalChip";

// Shortcut texts written into the goal field.
export const GOAL_CHIPS = ["Create an account", "Find and purchase", "General scan"];

// Stateless: the goal is the field's text, and a chip is selected only while the field
// matches it exactly.
export default function GoalChips({
  value,
  onPick,
}: {
  value: string;
  onPick: (text: string) => void;
}) {
  return (
    <div className="flex flex-1 flex-wrap gap-8">
      {GOAL_CHIPS.map((label) => (
        <GoalChip
          key={label}
          label={label}
          selected={value.trim() === label}
          onClick={() => onPick(label)}
        />
      ))}
    </div>
  );
}
