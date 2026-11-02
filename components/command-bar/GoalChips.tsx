"use client";

import GoalChip from "./GoalChip";

// Atajos de objetivo: textos que se escriben en el campo de objetivo.
export const GOAL_CHIPS = ["Create an account", "Find and purchase", "General scan"];

// Grupo de atajos. No guarda estado: el objetivo es el texto del campo.
// Pulsar un chip escribe su texto en el campo (reemplaza lo que hubiera),
// y un chip está seleccionado solo mientras el campo diga exactamente su
// texto; si el usuario lo edita, deja de estarlo.
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
