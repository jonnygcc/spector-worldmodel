"use client";

export type Mode = "automatic" | "personal";

const SEGMENT =
  "flex cursor-pointer items-center border py-4 font-body text-small font-medium leading-sm transition-colors duration-150";
const ACTIVE = "border-neutral-800 bg-neutral-800 text-neutral-100";
const INACTIVE = "border-neutral-300 bg-neutral-100 text-neutral-600";

// Selector de quién define los perfiles. Dos segmentos unidos: el activo
// es neutral-800 relleno, el inactivo va con borde neutral-300. Controlado:
// el estado vive en ModifierRow, que muestra los perfiles en Personal.
export default function ModeSwitch({
  value,
  onChange,
}: {
  value: Mode;
  onChange: (mode: Mode) => void;
}) {
  const automatic = value === "automatic";

  return (
    <div role="radiogroup" aria-label="Who defines the profiles" className="flex">
      <button
        type="button"
        role="radio"
        aria-checked={automatic}
        onClick={() => onChange("automatic")}
        className={`${SEGMENT} rounded-l-full pl-12 pr-8 ${automatic ? ACTIVE : INACTIVE}`}
      >
        Automatic
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={!automatic}
        onClick={() => onChange("personal")}
        className={`${SEGMENT} rounded-r-full border-l-0 pl-8 pr-12 ${automatic ? INACTIVE : ACTIVE}`}
      >
        Personal
      </button>
    </div>
  );
}
