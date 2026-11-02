"use client";

import { useState } from "react";
import { STAGES, type StageId } from "./stages";

export type { StageId };

const TOTAL = STAGES.length;
const LAPS = 3;
// Ítems de la vuelta del medio: [TOTAL, 2 × TOTAL).
const MIDDLE = TOTAL;
// Hueco central de los cinco visibles.
const CENTER = 2;

// Distancia a la activa → opacidad: activa 100%, adyacentes 50%, las dos
// de los extremos 30%. Lo que queda fuera de la ventana también va al 30%:
// no se ve, y así entra ya con su opacidad al desplazarse.
const OPACITY = ["", "opacity-50"];

const LABEL = "font-body text-body font-regular leading-rg text-neutral-800";

// Medidas, todas de tokens:
// - Ítem: h-stage (20px). Paso entre ítems H = stage + spacing-12 = 32px.
// - Ventana: cinco ítems y cuatro gaps = 5 × 20 + 4 × 12 = 148px.
// - Desplazamiento: el ítem `position` (índice en las tres vueltas) queda
//   en el hueco central, así que la lista sube (position − 2) × H.
const WINDOW = "h-[calc(var(--spacing-stage)*5+var(--spacing-12)*4)]";
const shift = (position: number) =>
  `translateY(calc(${CENTER - position} * (var(--spacing-stage) + var(--spacing-12))))`;

// La misma posición, llevada a la vuelta del medio.
const toMiddle = (position: number) => MIDDLE + (((position - MIDDLE) % TOTAL) + TOTAL) % TOTAL;

// Lista de etapas del motor (frame Desktop/Loading), circular: después de
// la sexta viene la primera. Se ven cinco y la activa va siempre en el
// centro, con las dos anteriores arriba y las dos siguientes abajo,
// tomadas en módulo seis (con la 1 activa, arriba están la 5 y la 6).
//
// Se renderizan tres vueltas de la lista dentro de una ventana de cinco
// ítems con overflow-hidden, y se desplaza con translateY sobre la vuelta
// del medio. Al avanzar, la lista sube con transición hacia la etapa
// siguiente aunque sea en otra vuelta (de la 6 a la 1 sigue subiendo);
// al terminar la transición, la posición vuelve a la vuelta del medio sin
// animación. Como las tres vueltas son idénticas, ese salto no se ve.
//
// Las tres vueltas son decorativas (aria-hidden): para lectores de
// pantalla hay un texto aparte con la etapa activa.
//
// El ancho es el de la etiqueta más larga, porque están todas. Los puntos
// suspensivos se dibujan en todas y solo se ven en la activa, para que el
// ancho no cambie al avanzar. Sin lógica de avance: la etapa activa llega
// como prop.
export default function StageList({ active = "load" }: { active?: StageId }) {
  const activeIndex = Math.max(STAGES.findIndex((s) => s.id === active), 0);

  const [shown, setShown] = useState(activeIndex);
  const [position, setPosition] = useState(MIDDLE + activeIndex);
  const [animate, setAnimate] = useState(false);

  // Cambio de etapa: avanza hacia ella por el camino más corto (hacia
  // abajo en la lista si va hacia delante), partiendo de la vuelta del
  // medio. Se ajusta durante el render para que posición y transición
  // cambien en el mismo frame.
  if (shown !== activeIndex) {
    let delta = (activeIndex - shown + TOTAL) % TOTAL;
    if (delta > TOTAL / 2) delta -= TOTAL;
    setShown(activeIndex);
    setPosition(toMiddle(position) + delta);
    setAnimate(true);
  }

  function settle(e: React.TransitionEvent<HTMLOListElement>) {
    if (e.target !== e.currentTarget || e.propertyName !== "transform") return;
    const middle = toMiddle(position);
    if (middle !== position) {
      setAnimate(false);
      setPosition(middle);
    }
  }

  const { label: activeLabel } = STAGES[activeIndex];

  return (
    <div className={`overflow-hidden ${WINDOW}`}>
      <p aria-live="polite" className="sr-only">
        Step {activeIndex + 1} of {TOTAL}: {activeLabel}
      </p>
      <ol
        aria-hidden="true"
        data-stage-list=""
        style={{ transform: shift(position) }}
        onTransitionEnd={settle}
        className={`flex flex-col items-start gap-12 ${
          animate ? "transition-transform duration-300 ease-out motion-reduce:transition-none" : ""
        }`}
      >
        {Array.from({ length: TOTAL * LAPS }, (_, index) => {
          const { id, label, Icon } = STAGES[index % TOTAL];
          const distance = Math.abs(index - position);
          const isActive = distance === 0;

          return (
            <li
              key={`${id}-${Math.floor(index / TOTAL)}`}
              data-active={isActive ? "" : undefined}
              className={`flex h-stage shrink-0 items-center gap-4 text-neutral-800 ${
                animate ? "transition-opacity duration-300 motion-reduce:transition-none" : ""
              } ${OPACITY[distance] ?? "opacity-30"}`}
            >
              <Icon
                aria-hidden="true"
                className={`size-16 shrink-0 ${isActive ? "text-accent" : ""}`}
              />
              <span className={LABEL}>
                {label}
                <span className={isActive ? "" : "invisible"}>…</span>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
