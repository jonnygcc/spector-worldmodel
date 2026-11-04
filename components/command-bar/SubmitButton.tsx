import { LoaderCircle, Search } from "lucide-react";

// Primary action: blue on a neutral background (design system button rule).
export default function SubmitButton({
  disabled = false,
  pending = false,
}: {
  disabled?: boolean;
  pending?: boolean;
}) {
  return (
    <button
      type="submit"
      aria-label={pending ? "Analyzing" : "Analyze"}
      // Not `disabled` while pending so it stays blue under the spinner; the bar ignores submits (aria-busy).
      disabled={disabled && !pending}
      aria-busy={pending}
      className="flex size-24 shrink-0 cursor-pointer items-center justify-center rounded-full bg-accent p-4 text-neutral-100 transition-colors duration-150 hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-neutral-300 disabled:hover:bg-neutral-300 aria-busy:cursor-wait"
    >
      {pending ? (
        <LoaderCircle aria-hidden="true" className="size-16 animate-spin" />
      ) : (
        <Search aria-hidden="true" className="size-16" />
      )}
    </button>
  );
}
