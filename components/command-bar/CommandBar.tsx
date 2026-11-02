"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import GoalChips from "./GoalChips";
import ModifierRow from "./ModifierRow";
import SubmitButton from "./SubmitButton";
import { normalizeUrl, readSubmission, type BarSubmission } from "./submission";

// Barra de comando de la Home (frame Desktop/Home de Paper).
// Arriba, los modificadores; debajo, dos campos apilados con un divisor
// entre ellos (la URL y el objetivo, con el mismo estilo y padding), y
// los atajos de objetivo con la acción. Cada control deja su valor en un
// input del formulario; al enviar se leen todos juntos (submission.ts).
//
// El objetivo es texto libre y es lo que se envía al motor. Los chips
// solo lo rellenan: pulsar uno escribe su texto en el campo, y está
// seleccionado mientras el campo diga exactamente eso.
//
// El botón se deshabilita sin URL válida, sin objetivo escrito, en
// Personal sin perfiles, y mientras corre el envío (con spinner).
//
// Foco: el indicador no está en el campo sino en la barra entera. Al enfocar
// el campo, borde accent y halo shadow-focus sumado a shadow-bar en la misma
// declaración. Si el campo es inválido, borde danger y shadow-focus-danger.
// Los selectores son excluyentes para no depender del orden de las reglas.
// Los dos campos comparten estilo: mismo texto, mismo color y placeholder.
const FIELD =
  "min-w-0 flex-1 bg-transparent outline-none font-body text-body font-regular leading-rg text-neutral-800 placeholder:text-neutral-400";

export default function CommandBar({
  onSubmit,
  pending = false,
  focusSignal = 0,
}: {
  onSubmit: (submission: BarSubmission) => void;
  pending?: boolean;
  // Cada vez que cambia, el campo de URL recibe el foco ("Edit URL").
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

      {/* Móvil: el botón va a la derecha del campo de URL. Desde lg, a la
          derecha de los chips. Se pinta en los dos sitios y cada uno se
          oculta en el breakpoint que no le toca, para que el orden de
          tabulación siga al visual. */}
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
