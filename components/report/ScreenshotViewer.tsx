"use client";

import { useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { ARROW as STRIP_ARROW } from "./arrow";
import StepNumber from "./StepNumber";
import type { Step } from "./sample";

// Las mismas flechas de la secuencia, centradas en vertical sobre la captura.
const ARROW = `absolute top-1/2 -translate-y-1/2 ${STRIP_ARROW}`;

// Visor de capturas del Reporte. Abre una captura de la secuencia a tamaño
// completo, hasta max-w-content (1080px) de ancho, centrada sobre el mismo
// scrim que el modal de perfiles. <dialog> nativo: atrapa el foco y cierra
// con Escape; también con la X y con click fuera de la card.
//
// Sin tema oscuro: arriba, una barra clara (neutral-100, borde
// neutral-300) con el número y la descripción del paso y la X a la
// derecha; debajo, la captura al ancho completo del visor. Las flechas son
// las mismas de la secuencia y pasan al paso anterior o siguiente de la
// misma ruta (también con ← y →, escuchadas en el documento para que
// sigan funcionando cuando la flecha pulsada desaparece en un extremo).
//
// Cualquier paso se abre igual, con captura o sin ella. Sin captura (ruta
// del World Model o datos de ejemplo), en el sitio de la imagen va un recuadro
// con la misma proporción que las capturas (16:10) y la descripción
// completa, que en la tira queda cortada a 3 líneas. En una ruta
// predicha, con "Predicted" encima, como su thumb.
export default function ScreenshotViewer({
  steps,
  simulated = false,
  index,
  onChange,
  onClose,
}: {
  steps: Step[];
  simulated?: boolean;
  // Paso abierto (índice en `steps`), o null si el visor está cerrado.
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
      // px-16 siempre, para que la captura nunca toque los bordes de la
      // pantalla; el ancho máximo suma ese padding a container-content,
      // así la captura sigue llegando a 1080px. Un click en el margen cae
      // en el propio <dialog> y cierra, como fuera de la card.
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
              // Captura real del navegador (data URL en JPEG).
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={step.screenshot}
                alt={`Step ${index + 1}: ${step.label}`}
                className={`block w-full rounded-md border ${
                  step.failed ? "border-danger" : "border-neutral-300"
                }`}
              />
            ) : (
              // Sin captura: la descripción completa. px-48 deja sitio a
              // las flechas, que van encima a spacing-12 de cada borde.
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
