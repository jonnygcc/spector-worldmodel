"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

// Solo Gemini funciona: el motor usa Gemini (lib/llm/gemini.ts) y la API
// no recibe modelo. El resto se muestra deshabilitado con "Soon".
const MODELS = [
  { name: "Opus 5.5", available: false },
  { name: "GPT Astra", available: false },
  { name: "Opus 4.7", available: false },
  { name: "Gemini Flash", available: true },
];

// Selector de modelo (frames Desktop/Home y Desktop/Home/Model AI).
// Abre y cierra con click en el trigger; elegir un ítem lo selecciona y
// cierra; Escape y click fuera cierran. El menú cuelga 4px bajo el
// trigger, alineado a la derecha. El modelo elegido viaja con el
// formulario en un input oculto "model".
export default function ModelPicker({
  defaultModel = "Gemini Flash",
}: {
  defaultModel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [model, setModel] = useState(defaultModel);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function select(name: string) {
    setModel(name);
    setOpen(false);
    triggerRef.current?.focus();
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex cursor-pointer items-center gap-4 rounded-full border border-neutral-300 py-4 pl-12 pr-8 text-neutral-700 transition-colors duration-150 hover:border-neutral-800 hover:text-neutral-800 aria-expanded:border-neutral-800 aria-expanded:text-neutral-800"
      >
        <span className="font-body text-small font-medium leading-sm">{model}</span>
        <ChevronDown
          aria-hidden="true"
          className={`size-16 shrink-0 text-neutral-800 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Model"
          className="absolute left-0 top-full z-10 mt-4 lg:left-auto lg:right-0 flex w-menu flex-col gap-4 rounded-md border border-neutral-300 bg-neutral-100 p-4"
        >
          {MODELS.map(({ name, available }) =>
            available ? (
              <button
                key={name}
                type="button"
                role="menuitemradio"
                aria-checked={name === model}
                onClick={() => select(name)}
                className="flex cursor-pointer items-center rounded-full px-8 py-4 font-body text-small font-medium leading-sm text-neutral-800 transition-colors duration-150 hover:bg-neutral-200 aria-checked:bg-neutral-200"
              >
                {name}
              </button>
            ) : (
              <button
                key={name}
                type="button"
                role="menuitemradio"
                aria-checked={false}
                aria-disabled="true"
                disabled
                className="flex items-center justify-between gap-8 rounded-full px-8 py-4 font-body text-small font-medium leading-sm text-neutral-400"
              >
                {name}
                <span className="font-heading text-label font-medium uppercase leading-sm tracking-wide">
                  Soon
                </span>
              </button>
            )
          )}
        </div>
      )}
      <input type="hidden" name="model" value={model} />
    </div>
  );
}
