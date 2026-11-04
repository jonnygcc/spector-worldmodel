"use client";

// Selection is owned by GoalChips; the chip only reflects it through aria-pressed.
export default function GoalChip({
  label,
  selected = false,
  onClick,
}: {
  label: string;
  selected?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className="flex cursor-pointer items-center rounded-full border border-neutral-300 bg-neutral-100 px-12 py-4 font-body text-small font-regular leading-sm text-neutral-600 transition-colors duration-150 hover:border-neutral-800 hover:text-neutral-800 aria-pressed:border-neutral-800 aria-pressed:text-neutral-800"
    >
      {label}
    </button>
  );
}
