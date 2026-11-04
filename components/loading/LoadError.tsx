import { GlobeOff } from "lucide-react";
import RetryButton from "./RetryButton";

// Inside a danger-10 block the primary button is neutral-800, not blue (button rule). The width
// comes from the text block (w-message), not the card. Title and help depend on the failed stage.
export default function LoadError({
  url = "https://linear.app",
  reason,
  failedWhileLoading = true,
  retryable = true,
  retryAfterSeconds,
  onEdit,
  onRetry,
}: {
  url?: string;
  reason?: string;
  failedWhileLoading?: boolean;
  retryable?: boolean;
  retryAfterSeconds?: number;
  onEdit?: () => void;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex w-full flex-col items-center gap-8 rounded-md bg-danger-10 px-24 py-32 lg:w-auto lg:gap-16 lg:rounded-lg lg:p-48"
    >
      <GlobeOff aria-hidden="true" className="size-24 shrink-0 text-danger" />

      <div className="flex w-full flex-col items-center gap-16 lg:w-message lg:gap-24">
        <div className="flex flex-col gap-8 text-center">
          <h1 className="flex flex-col font-heading text-h5 font-medium leading-rg lg:text-h4">
            <span className="text-neutral-800">
              {failedWhileLoading ? "Spector couldn't load" : "Spector couldn't analyze"}
            </span>
            <span className="break-all text-danger">{url}</span>
          </h1>
          <p className="font-body text-small font-regular leading-lg text-balance text-neutral-600 lg:text-body">
            {failedWhileLoading
              ? "Check that the site is public and loads without a login, then try again."
              : "The analysis stopped before finishing. Try again in a moment."}
          </p>
          {reason && (
            <p className="break-words font-body text-small font-regular leading-sm text-neutral-600">
              {reason}
            </p>
          )}
        </div>

        <div className="flex items-center gap-12 lg:gap-16">
          <button
            type="button"
            onClick={onEdit}
            className="flex cursor-pointer items-center rounded-full bg-neutral-800 px-12 py-4 font-body text-small font-medium leading-rg text-neutral-100 lg:px-16 lg:py-8 lg:text-body"
          >
            Edit URL
          </button>
          <RetryButton
            label="Try again"
            onRetry={onRetry}
            retryable={retryable}
            retryAfterSeconds={retryAfterSeconds}
            className="cursor-pointer font-body text-small font-medium leading-rg text-neutral-700 transition-colors lg:text-body duration-150 hover:text-neutral-800"
          />
        </div>
      </div>
    </div>
  );
}
