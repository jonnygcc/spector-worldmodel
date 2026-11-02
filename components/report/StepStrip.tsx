"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import ScreenshotViewer from "./ScreenshotViewer";
import { ARROW } from "./arrow";
import Tooltip from "@/components/tooltip/Tooltip";
import StepNumber from "./StepNumber";
import type { Step } from "./sample";

// SIN TOKEN — medidas propias de la captura, todas del frame.
const THUMB_W = "w-[200px]"; // ancho de la captura, y de cada paso
const THUMB = `${THUMB_W} h-[125px]`; // captura 200×125
const THUMB_ROW = "h-[125px]"; // alto de la fila de capturas, para centrar las flechas
// Padding interno del carril: con overflow-x: auto el overflow-y no puede
// ser visible, y el borde superior de las tarjetas se recortaba. 6px
// arriba, 2px abajo y 3px a los lados (en móvil manda el gutter de 16).
const RAIL_PAD = "pb-[2px] pt-[6px] px-16 lg:pl-[3px]";
const ARROW_TOP = "top-[6px]"; // las flechas bajan lo mismo que las capturas
// Esqueleto de página dentro de la captura (placeholder hasta tener
// capturas reales): barras de 36×6, 120×8, 150×6, 85×6 y pastilla 48×14.
const BAR = "rounded-[1px] bg-neutral-200";

// Movimiento de las flechas: el spring del diseño (stiffness 200, damping
// 40, mass 1) es sobreamortiguado, sin rebote. Se aproxima con 500ms y
// cubic-bezier(0.22, 1, 0.36, 1): arranca rápido y frena suave al llegar.
const SCROLL_DURATION = 500;
const scrollEase = cubicBezier(0.22, 1, 0.36, 1);

// Curva cubic-bezier(x1, y1, x2, y2) como en CSS: dado el progreso en el
// tiempo (x), devuelve el progreso del movimiento (y). Resuelve x(t) con
// Newton y, si no converge, por bisección.
function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
  const coord = (t: number, a: number, b: number) =>
    3 * a * t * (1 - t) ** 2 + 3 * b * t ** 2 * (1 - t) + t ** 3;
  const slope = (t: number, a: number, b: number) =>
    3 * a * (1 - t) ** 2 + 6 * (b - a) * t * (1 - t) + 3 * (1 - b) * t ** 2;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const dx = coord(t, x1, x2) - x;
      const d = slope(t, x1, x2);
      if (Math.abs(dx) < 1e-6) return coord(t, y1, y2);
      if (Math.abs(d) < 1e-6) break;
      t -= dx / d;
    }
    let lo = 0;
    let hi = 1;
    t = x;
    for (let i = 0; i < 30; i++) {
      const cx = coord(t, x1, x2);
      if (Math.abs(cx - x) < 1e-6) break;
      if (cx < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return coord(t, y1, y2);
  };
}

// Cualquier paso se abre en el visor: con captura muestra la imagen; sin
// ella (escenario del World Model o datos de ejemplo), la descripción completa.
//
// Foco de teclado (y el paso que queda enfocado al cerrar el visor): no
// lleva el anillo global, que queda fuera del recuadro y lo recorta el
// scroll de la tira. El recuadro conserva su borde de 1px y solo cambia
// su color a accent.
const FOCUS = "group-focus-visible/thumb:border-accent";

function Thumb({
  failed,
  screenshot,
  simulated,
  label,
  onOpen,
}: {
  failed?: boolean;
  screenshot?: string;
  simulated?: boolean;
  label: string;
  onOpen: () => void;
}) {
  // Borde sólido neutral-200 (frame Desktop/Reporte/World Model), también
  // en los pasos predichos; danger si el paso falló.
  const border = failed ? "border-danger" : "border-neutral-200";

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={screenshot ? `Open screenshot: ${label}` : `Open step: ${label}`}
      className={`group/thumb shrink-0 cursor-zoom-in rounded-sm focus-visible:outline-none ${THUMB}`}
    >
      {screenshot ? (
        // Captura real del navegador (data URL en JPEG): no pasa por
        // next/image porque no hay nada que optimizar.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={screenshot}
          alt=""
          className={`size-full rounded-sm border bg-neutral-100 object-cover object-top ${border} ${FOCUS}`}
        />
      ) : simulated ? (
        // Escenario predicho: el paso no se ejecutó, no hay captura. El recuadro
        // dice "Predicted", en vez de un esqueleto que parece una carga
        // fallida.
        <span
          className={`flex size-full items-center justify-center rounded-sm border bg-neutral-100 ${border} ${FOCUS}`}
        >
          <span className="font-body text-small font-regular leading-sm text-neutral-400">
            Predicted
          </span>
        </span>
      ) : (
        <span
          className={`flex size-full flex-col gap-12 overflow-clip rounded-sm border bg-neutral-100 p-8 ${border} ${FOCUS}`}
        >
          <span className="flex flex-col gap-8">
            <span className={`block h-[6px] w-[36px] ${BAR}`} />
            <span className="flex flex-col gap-8">
              <span className={`block h-8 w-[120px] ${BAR}`} />
              <span className="flex flex-col gap-4">
                <span className={`block h-[6px] w-[150px] ${BAR}`} />
                <span className={`block h-[6px] w-[85px] ${BAR}`} />
              </span>
            </span>
          </span>
          <span className="block h-[14px] w-48 shrink-0 rounded-full bg-neutral-600" />
        </span>
      )}
    </button>
  );
}

// Descripción de un paso, cortada a 3 líneas con "…". Solo si de verdad
// se corta, al pasar el cursor muestra el texto completo en un tooltip
// claro. El texto entero está en el DOM (line-clamp solo lo oculta a la
// vista), así que el lector de pantalla lo lee completo.
// `full` (World Model): sin corte, el texto hace wrap en las líneas que
// necesite; el motor ya lo limita a una acción corta.
function StepLabel({ step, full = false }: { step: Step; full?: boolean }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [clipped, setClipped] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setClipped(el.scrollHeight > el.clientHeight + 1);
    measure();
    // Con la fuente aún sin cargar el texto ocupa menos y no se corta; al
    // cargar, el párrafo sigue midiendo 3 líneas y el ResizeObserver no
    // salta. Se vuelve a medir cuando las fuentes están listas.
    let alive = true;
    document.fonts.ready.then(() => alive && measure());
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => {
      alive = false;
      observer.disconnect();
    };
  }, [step.label]);

  const text = (
    <p
      ref={ref}
      className={`${full ? "" : "line-clamp-3 "}break-words font-body text-small leading-sm ${
        step.failed && !step.unreached ? "text-danger" : "text-neutral-800"
      }`}
    >
      {step.label}
    </p>
  );

  // Siempre dentro del Tooltip, apagado si no se corta: si el envoltorio
  // apareciera y desapareciera, el párrafo se volvería a montar y el
  // ResizeObserver quedaría mirando el nodo viejo.
  return (
    <Tooltip content={step.label} tone="light" className="flex" disabled={!clipped}>
      {text}
    </Tooltip>
  );
}

// Secuencia de capturas de una ruta. Cada paso: captura, número y
// descripción. Cada paso mide lo mismo que su captura: la descripción hace
// wrap hasta 3 líneas y, si se corta, el texto completo sale en un tooltip
// al pasar el cursor (en el World Model, entera y sin corte). Una línea pasa por detrás de los números, de la
// primera a la última. Un tramo va en azul solo si une dos pasos
// alcanzados; si entra en un paso no alcanzado (`unreached`, ver
// withReach), o sale de él, va en neutral-200. Así el
// tramo que entra en el paso donde la ruta se detuvo ya es gris. El paso
// que falló dentro del tramo alcanzado se marca en danger. Si
// no caben, la fila se desplaza con las flechas. Click en una captura la
// abre a tamaño completo (ScreenshotViewer).
export default function StepStrip({
  steps,
  simulated = false,
}: {
  steps: Step[];
  // Escenario del World Model, no ejecutado: cada paso es un recuadro
  // con "Predicted", nunca una captura.
  simulated?: boolean;
}) {
  const scrollerRef = useRef<HTMLOListElement>(null);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(false);
  const [viewing, setViewing] = useState<number | null>(null);

  function update() {
    const el = scrollerRef.current;
    if (!el) return;
    setCanPrev(el.scrollLeft > 0);
    setCanNext(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }

  useEffect(() => {
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // Desplazamiento de las flechas, animado a mano. Sin behavior: "smooth"
  // ni scroll-behavior en CSS: usan la curva del navegador, y Chrome los
  // anula si el sistema tiene las animaciones desactivadas.
  // - Al pulsar: posición actual de scrollLeft y posición destino (un paso
  //   = ancho de la captura + gap, dentro de los límites del scroll).
  // - requestAnimationFrame durante SCROLL_DURATION (500ms); en cada frame
  //   el progreso 0–1 pasa por scrollEase (cubic-bezier(0.22, 1, 0.36, 1))
  //   y se asigna a scrollLeft directamente.
  // - Un nuevo click cancela la animación en curso y arranca otra desde la
  //   posición actual. El destino se cuenta desde el destino anterior, no
  //   desde la posición a medio camino, para que la tira siempre se pare
  //   alineada con una captura.
  // Se anima también con prefers-reduced-motion: es un movimiento corto
  // que dispara el propio usuario.
  //
  // El scroll táctil, la rueda y el arrastre son los nativos: si el usuario
  // toca la tira durante la animación, se cancela y manda él.
  const animation = useRef<{ frame: number; target: number } | null>(null);

  function stopAnimation() {
    if (animation.current) cancelAnimationFrame(animation.current.frame);
    animation.current = null;
  }

  useEffect(() => stopAnimation, []);

  function scrollByStep(direction: 1 | -1) {
    const el = scrollerRef.current;
    const first = el?.firstElementChild as HTMLElement | null;
    if (!el || !first) return;
    const gap = parseFloat(getComputedStyle(el).columnGap) || 0;
    const max = el.scrollWidth - el.clientWidth;
    const base = animation.current ? animation.current.target : el.scrollLeft;
    const target = Math.min(Math.max(base + direction * (first.offsetWidth + gap), 0), max);
    stopAnimation();

    const from = el.scrollLeft;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - start) / SCROLL_DURATION, 1);
      el.scrollLeft = from + (target - from) * scrollEase(t);
      if (t < 1) animation.current = { frame: requestAnimationFrame(tick), target };
      else animation.current = null;
    };
    animation.current = { frame: requestAnimationFrame(tick), target };
  }

  return (
    <div className="relative w-full min-w-0">
      <ol
        ref={scrollerRef}
        onScroll={update}
        // Scroll nativo del usuario (toque, rueda o arrastre): la animación
        // de la flecha se cancela y no pelea con él.
        onPointerDown={stopAnimation}
        onTouchStart={stopAnimation}
        onWheel={stopAnimation}
        className={`flex w-full gap-8 overflow-x-auto ${RAIL_PAD} [scrollbar-width:none] [&::-webkit-scrollbar]:hidden`}
      >
        {steps.map((step, i) => {
          const last = i === steps.length - 1;
          const next = steps[i + 1];
          const reached = !step.unreached && !next?.unreached;
          return (
            <li key={i} className={`flex shrink-0 flex-col gap-12 ${THUMB_W}`}>
              <Thumb
                failed={step.failed}
                screenshot={step.screenshot}
                simulated={simulated}
                label={step.label}
                onOpen={() => setViewing(i)}
              />
              <div className="flex flex-col gap-8">
                <div className="relative flex items-center">
                  {!last && (
                    <span
                      aria-hidden="true"
                      className={`absolute -right-8 left-0 top-1/2 -translate-y-1/2 border-t-2 ${
                        reached ? "border-accent" : "border-neutral-200"
                      }`}
                    />
                  )}
                  <StepNumber steps={steps} index={i} />
                </div>
                <StepLabel step={step} full={simulated} />
              </div>
            </li>
          );
        })}
      </ol>

      {canPrev && (
        <div className={`absolute left-16 flex items-center lg:left-0 ${ARROW_TOP} ${THUMB_ROW}`}>
          <button type="button" aria-label="Previous steps" onClick={() => scrollByStep(-1)} className={ARROW}>
            <ChevronLeft aria-hidden="true" className="size-16" />
          </button>
        </div>
      )}
      {canNext && (
        <div className={`absolute right-16 flex items-center ${ARROW_TOP} ${THUMB_ROW}`}>
          <button type="button" aria-label="Next steps" onClick={() => scrollByStep(1)} className={ARROW}>
            <ChevronRight aria-hidden="true" className="size-16" />
          </button>
        </div>
      )}

      <ScreenshotViewer
        steps={steps}
        simulated={simulated}
        index={viewing}
        onChange={setViewing}
        onClose={() => setViewing(null)}
      />
    </div>
  );
}
