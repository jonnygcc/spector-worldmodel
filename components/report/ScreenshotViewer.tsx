"use client";

import { useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { ARROW as STRIP_ARROW } from "./arrow";
import StepNumber from "./StepNumber";
import type { Step } from "./sample";

// The sequence's own arrows, vertically centered over the screenshot.
const ARROW = `absolute top-1/2 -translate-y-1/2 ${STRIP_ARROW}`;

// ← and → are listened on the document so they keep working when the clicked arrow disappears
// at either end. Steps without a screenshot show a 16:10 box with the full description.
export default function ScreenshotViewer({
  steps,
  simulated = false,
  index,
  onChange,
  onClose,
}: {
  steps: Step[];
  simulated?: boolean;
  // Open step (index into `steps`), or null when closed.
  index: number | null;
  onChange: (index: number) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const open = index !== null;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const prev = index !== null && index > 0 ? index - 1 : null;
  const next = index !== null && index < steps.length - 1 ? index + 1 : null;
  const step = index === null ? null : steps[index];

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowLeft" && prev !== null) onChange(prev);
      if (e.key === "ArrowRight" && next !== null) onChange(next);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, prev, next, onChange]);

  return (
    <dialog
      ref={dialogRef}
      aria-label="Screenshot"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose();
      }}
      // px-16 always, so the screenshot never touches the screen edges; the max width adds it back so
      // the image still reaches 1080px. A click in the margin lands on the <dialog> and closes it.
      className="m-auto w-full max-w-[calc(var(--container-content)+var(--spacing-16)*2)] bg-transparent p-0 px-16 backdrop:bg-neutral-700/50"
    >
      {step && index !== null && (
        <div className="flex flex-col gap-8">
          <div className="flex items-center gap-8 rounded-md border border-neutral-300 bg-neutral-100 px-12 py-8">
            <StepNumber steps={steps} index={index} />
            <p
              className={`flex-1 truncate font-body text-small leading-sm ${
                step.failed && !step.unreached ? "text-danger" : "text-neutral-800"
              }`}
              title={step.label}
            >
              {step.label}
            </p>
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              className="flex shrink-0 cursor-pointer items-center justify-center text-neutral-600 transition-colors duration-150 hover:text-neutral-800"
            >
              <X aria-hidden="true" className="size-16" />
            </button>
          </div>

          <div className="relative">
            {step.screenshot ? (
              // A JPEG data URL: next/image has nothing to optimize.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={step.screenshot}
                alt={`Step ${index + 1}: ${step.label}`}
                className={`block w-full rounded-md border ${
                  step.failed ? "border-danger" : "border-neutral-300"
                }`}
              />
            ) : (
              // px-48 leaves room for the arrows, which sit spacing-12 from each edge.
              <div
                className={`flex aspect-[16/10] w-full flex-col items-center justify-center gap-8 rounded-md border bg-neutral-100 px-48 text-center ${
                  simulated
                    ? "border-neutral-300"
                    : step.failed
                      ? "border-danger"
                      : "border-neutral-300"
                }`}
              >
                {simulated && (
                  <span className="font-body text-small font-regular leading-sm text-neutral-400">
                    Predicted
                  </span>
                )}
                <p
                  className={`max-w-narrow font-body text-body font-regular leading-lg ${
                    step.failed && !step.unreached ? "text-danger" : "text-neutral-800"
                  }`}
                >
                  {step.label}
                </p>
              </div>
            )}
            {prev !== null && (
              <button
                type="button"
                aria-label="Previous step"
                onClick={() => onChange(prev)}
                className={`${ARROW} left-12`}
              >
                <ChevronLeft aria-hidden="true" className="size-16" />
              </button>
            )}
            {next !== null && (
              <button
                type="button"
                aria-label="Next step"
                onClick={() => onChange(next)}
                className={`${ARROW} right-12`}
              >
                <ChevronRight aria-hidden="true" className="size-16" />
              </button>
            )}
          </div>
        </div>
      )}
    </dialog>
  );
}
