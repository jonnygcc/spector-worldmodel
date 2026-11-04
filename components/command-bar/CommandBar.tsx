"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import GoalChips from "./GoalChips";
import ModifierRow from "./ModifierRow";
import SubmitButton from "./SubmitButton";
import { normalizeUrl, readSubmission, type BarSubmission } from "./submission";

// The goal is free text and is what the engine receives; chips only fill it in. Focus styles
// live on the whole bar, with mutually exclusive selectors so rule order doesn't matter.
const FIELD =
  "min-w-0 flex-1 bg-transparent outline-none font-body text-body font-regular leading-rg text-neutral-800 placeholder:text-neutral-400";

export default function CommandBar({
  onSubmit,
  pending = false,
  focusSignal = 0,
}: {
  onSubmit: (submission: BarSubmission) => void;
  pending?: boolean;
  // Each change focuses the URL field ("Edit URL").
  focusSignal?: number;
}) {
  const [url, setUrl] = useState("");
  const [goal, setGoal] = useState("");
  const [touched, setTouched] = useState(false);
  const [personaReady, setPersonaReady] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  const validUrl = normalizeUrl(url) !== null;
  const invalid = touched && url.trim() !== "" && !validUrl;
  const ready = validUrl && goal.trim() !== "" && personaReady;
  const canSubmit = ready && !pending;

  useEffect(() => {
    if (focusSignal > 0) inputRef.current?.focus();
  }, [focusSignal]);

  const handlePersonaChange = useCallback((ready: boolean) => setPersonaReady(ready), []);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    const submission = readSubmission(event.currentTarget);
    if (submission) onSubmit(submission);
  }

  return (
    <form
      noValidate
      onSubmit={handleSubmit}
      aria-busy={pending}
      className="flex w-full flex-col lg:max-w-command gap-16 rounded-lg border border-neutral-300 bg-neutral-100 py-12 shadow-bar has-[input:focus:not([aria-invalid=true])]:border-accent has-[input:focus:not([aria-invalid=true])]:shadow-[var(--shadow-bar),var(--shadow-focus)] has-[[aria-invalid=true]]:border-danger has-[input:focus[aria-invalid=true]]:shadow-[var(--shadow-bar),var(--shadow-focus-danger)]"
    >
      <ModifierRow onPersonaChange={handlePersonaChange} />

      <div className="border-t border-neutral-300" />

      {/* Rendered in both spots and hidden per breakpoint so tab order follows the visual order. */}
      <div className="flex items-center gap-8 pl-16 pr-12">
        <input
          ref={inputRef}
          type="url"
          name="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onBlur={() => setTouched(true)}
          placeholder="https://example.com"
          aria-label="Site to analyze"
          aria-invalid={invalid}
          autoComplete="url"
          className={FIELD}
        />
        <span className="flex lg:hidden">
          <SubmitButton disabled={!ready} pending={pending} />
        </span>
      </div>

      <div className="border-t border-neutral-300" />

      <div className="flex flex-col gap-24">
        <div className="flex items-center pl-16 pr-12">
          <input
            type="text"
            name="goal"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="e.g. sign up for a team plan"
            aria-label="Goal"
            autoComplete="off"
            className={FIELD}
          />
        </div>
        <div className="flex items-center px-12">
          <GoalChips value={goal} onPick={setGoal} />
          <span className="hidden lg:flex">
            <SubmitButton disabled={!ready} pending={pending} />
          </span>
        </div>
      </div>
    </form>
  );
}
