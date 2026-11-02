"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import FrictionBar from "./FrictionBar";
import StatusBadge from "./StatusBadge";
import { pathLength, withReach } from "./pathSteps";
import StepStrip from "./StepStrip";
import type { Route } from "./sample";

// SIN TOKEN — anchos de columna del frame. STEPS usa spacing-96 (96px),
// como en Paper. STATUS mide 140 en cabecera y filas; en Paper la cabecera
// medía 180 porque sumaba el hueco del chevron (140 + 16 + 24), que aquí
// es una columna propia de 24 (spacing-24) también en la cabecera.
const COL = {
  time: "w-[100px]",
  probability: "w-[100px]",
  steps: "w-96",
  friction: "w-[200px]", // cabe "FRICTION (LOWER IS BETTER)" en una línea
  status: "w-[140px]",
  chevron: "w-24",
};

const HEAD =
  "font-heading text-label font-medium uppercase leading-rg tracking-wide text-neutral-600";

// Los encabezados no llevan tooltip: FRICTION dice en la propia etiqueta
// lo que hace falta. Solo los badges de estado lo tienen.
const FRICTION_LABEL = "Friction (lower is better)";

const NUMBER =
  "font-heading text-body leading-sm tracking-wide tabular-nums text-neutral-800";

// Columnas que solo existen en escritorio (lg, desde 1024px).
const DESKTOP = "hidden lg:block";

// Métrica en móvil: etiqueta encima del valor (frame Phone/Reporte).
function Metric({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-8">
      <span className={HEAD}>{label}</span>
      {children}
    </div>
  );
}

// Tabla de rutas del reporte. Una fila abierta a la vez: abrir otra
// cierra la anterior, y volver a pulsar la abierta la cierra. La primera
// arranca abierta.
//
// Mobile-first (frame Phone/Reporte, hasta 1024px): deja de ser tabla y
// pasa a lista. La cabecera solo tiene la primera columna y cada fila, el
// nombre y el chevron. Al abrirla, las métricas aparecen dentro con su
// etiqueta encima, en dos líneas (TIME, PROBABILITY, STEPS / FRICTION,
// STATUS), y debajo la tira de capturas con scroll horizontal.
// Desde lg (frame Desktop/Reporte) es la tabla de siempre.
//
// `firstColumn`: el diseño la llama USER (una fila por perfil); el motor
// devuelve una fila por ruta para una sola persona, así que en el
// análisis real se titula "Route".
//
// La misma tabla sirve al World Model: filas con `estimated` (escenarios
// predichos) llevan "~" en steps y pasos sin captura; `subtitle` es el
// tipo de escenario, en gris bajo el nombre; `recommendation`, una card
// al final de la fila abierta, bajo el timeline. `showTime={false}` quita
// la columna Time (el World Model no la tiene).
// `id` distingue los paneles cuando hay dos tablas en la página.
export default function ReportTable({
  routes,
  firstColumn = "User",
  id = "route",
  showTime = true,
}: {
  routes: Route[];
  firstColumn?: string;
  id?: string;
  showTime?: boolean;
}) {
  const [open, setOpen] = useState<number | null>(0);

  return (
    // overflow-hidden: nada sale de la card ni pisa su radio (el timeline
    // scrollea dentro, en su propio carril). Los tooltips van en un portal,
    // así que no se recortan. min-w-0 para que el contenido ancho no la
    // ensanche.
    <div className="flex w-full min-w-0 flex-col overflow-hidden rounded-md border border-neutral-300 bg-neutral-100 shadow-bar">
      <div className="flex items-center gap-16 rounded-t-md border-b border-neutral-300 bg-surface px-16 py-12">
        <span className={`flex-1 ${HEAD}`}>{firstColumn}</span>
        {showTime && <span className={`shrink-0 ${COL.time} ${HEAD} ${DESKTOP}`}>Time</span>}
        <span className={`shrink-0 ${COL.probability} ${HEAD} ${DESKTOP}`}>Probability</span>
        <span className={`shrink-0 ${COL.steps} ${HEAD} ${DESKTOP}`}>Steps</span>
        <span className={`shrink-0 ${COL.friction} ${HEAD} ${DESKTOP}`}>{FRICTION_LABEL}</span>
        <span className={`shrink-0 ${COL.status} ${HEAD} ${DESKTOP}`}>Status</span>
        <span aria-hidden="true" className={`shrink-0 ${COL.chevron} ${DESKTOP}`} />
      </div>

      <ul>
        {routes.map((route, i) => {
          const isOpen = open === i;
          const panelId = `${id}-${i}-steps`;
          const statusTipId = `${id}-${i}-status-tip`;
          const count = route.stepCount ?? pathLength(route.steps);
          const steps = route.estimated ? `~${count}` : count;

          return (
            <li
              key={i}
              className="border-b border-neutral-300 py-16 last:border-b-0 lg:py-24 lg:pl-16"
            >
              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={panelId}
                aria-describedby={route.status ? statusTipId : undefined}
                onClick={() => setOpen(isOpen ? null : i)}
                // data-tip-anchor: al enfocar la fila con teclado se abre el
                // tooltip del badge de estado (columna de escritorio).
                data-tip-anchor=""
                className="flex w-full cursor-pointer items-center gap-16 px-16 text-left lg:pl-0"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-4 break-words">
                  <span className="font-body text-body font-medium leading-lg text-neutral-800">
                    {route.user}
                  </span>
                  {route.subtitle && (
                    <span className="font-body text-small leading-sm text-neutral-600">
                      {route.subtitle}
                    </span>
                  )}
                </span>
                {showTime && (
                  <span className={`shrink-0 ${COL.time} ${NUMBER} ${DESKTOP}`}>{route.time}</span>
                )}
                <span className={`shrink-0 ${COL.probability} ${NUMBER} ${DESKTOP}`}>
                  {route.probability}
                </span>
                <span className={`shrink-0 ${COL.steps} ${NUMBER} ${DESKTOP}`}>{steps}</span>
                <span className={`shrink-0 ${COL.friction} ${DESKTOP}`}>
                  <FrictionBar value={route.friction.value} level={route.friction.level} />
                </span>
                <span className={`shrink-0 ${COL.status} ${DESKTOP}`}>
                  {route.status ? (
                    <StatusBadge
                      status={route.status}
                      tooltipId={statusTipId}
                      predicted={route.estimated}
                    />
                  ) : (
                    <span className={NUMBER}>—</span>
                  )}
                </span>
                <ChevronDown
                  aria-hidden="true"
                  className={`size-24 shrink-0 text-neutral-800 transition-transform duration-150 ${
                    isOpen ? "rotate-180" : ""
                  }`}
                />
              </button>

              {/* Abre y cierra con la altura animada (0fr → 1fr). El espacio
                  extra de la fila abierta va dentro, para que se anime con
                  ella: en escritorio 24 arriba y 8 más abajo (24/32 en
                  Paper); en móvil 24 arriba y 16 más abajo (16/32). */}
              <div
                id={panelId}
                // Columna minmax(0, 1fr): con la columna auto del grid, el
                // timeline (más ancho que la card) la ensanchaba y se salía
                // del borde derecho.
                className={`grid grid-cols-[minmax(0,1fr)] transition-[grid-template-rows] duration-150 ${
                  isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                }`}
              >
                <div className="min-w-0 overflow-hidden" inert={!isOpen}>
                  <div className="flex min-w-0 flex-col gap-24 pb-16 pt-24 lg:pb-8">
                    <div className="flex flex-col gap-24 px-16 lg:hidden">
                      <div className="flex flex-wrap gap-24">
                        {showTime && (
                          <Metric label="Time">
                            <span className={NUMBER}>{route.time}</span>
                          </Metric>
                        )}
                        <Metric label="Probability">
                          <span className={NUMBER}>{route.probability}</span>
                        </Metric>
                        <Metric label="Steps">
                          <span className={NUMBER}>{steps}</span>
                        </Metric>
                      </div>
                      <div className="flex flex-wrap gap-24">
                        <Metric label={FRICTION_LABEL}>
                          <FrictionBar value={route.friction.value} level={route.friction.level} />
                        </Metric>
                        <Metric label="Status">
                          {route.status ? (
                            <StatusBadge status={route.status} predicted={route.estimated} />
                          ) : (
                            <span className={NUMBER}>—</span>
                          )}
                        </Metric>
                      </div>
                    </div>

                    <StepStrip steps={withReach(route)} simulated={route.estimated} />

                    {/* Recomendación (World Model): card success-10, padding
                        spacing-16 × spacing-24 y radius-md, como la caja de
                        nota del frame. Título h5 (18px) medium neutral-800 y la
                        frase en body regular neutral-700. */}
                    {route.recommendation && (
                      <div className="px-16 lg:pl-0">
                        <div className="flex min-w-0 flex-col gap-8 break-words rounded-md bg-success-10 px-24 py-16">
                          <h3 className="font-heading text-h5 font-medium leading-rg text-neutral-800">
                            Recommendation
                          </h3>
                          <p className="font-body text-body font-regular leading-lg text-neutral-700">
                            {route.recommendation}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
