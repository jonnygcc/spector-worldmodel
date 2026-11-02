import { Plus } from "lucide-react";

// "+ Add profile". Pastilla con borde; hover en neutral-800, el mismo
// patrón que el trigger de modelos y los goal chips.
export default function AddProfileButton({
  onClick,
  disabled = false,
}: {
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex shrink-0 cursor-pointer items-center gap-4 rounded-full border border-neutral-300 py-4 pl-8 pr-12 font-body text-small font-medium leading-sm text-neutral-600 transition-colors duration-150 hover:border-neutral-800 hover:text-neutral-800 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-neutral-300 disabled:hover:text-neutral-600"
    >
      <Plus aria-hidden="true" className="size-16 shrink-0" />
      Add profile
    </button>
  );
}
