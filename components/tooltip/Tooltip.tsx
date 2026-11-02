"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

// Tooltip reutilizable. Burbuja neutral-800 con texto neutral-100 en
// text-small, radius-md, padding spacing-8 y una flecha que apunta al
// elemento. Se abre:
//
// - Con el ratón: al entrar en el elemento, sin retraso. Al salir se
//   oculta.
//   Aparece con un fundido de opacidad de 300ms y se va con uno de 150ms;
//   durante la salida sigue montada (sin recibir el puntero) y luego se
//   desmonta.
// - Con teclado: al enfocar con :focus-visible.
//   · `focusable`: el propio envoltorio entra en el orden de tabulación
//     (para elementos no interactivos, como un encabezado de columna).
//   · Si el elemento está dentro de un control que ya recibe el foco (el
//     botón de una fila), ese control lleva `data-tip-anchor` y
//     `aria-describedby` con el `id` del tooltip; al enfocarlo se abre.
// - En táctil: tocar el elemento lo abre y lo cierra; tocar fuera lo
//   cierra. El toque no llega al control que lo contiene.
// Escape, el scroll y el cambio de tamaño de la ventana lo cierran.
//
// La burbuja se pinta en un portal con posición fija: no la recortan los
// contenedores con overflow (el panel animado de las filas) y, cerrada,
// no existe, así que nunca genera scroll horizontal. Va encima del
// elemento; si no cabe, debajo. Se desplaza en horizontal para no salirse
// de la pantalla (margen spacing-16) y la flecha sigue apuntando al
// centro del elemento.
//
// El texto vive siempre en un span `hidden` con el `id`, para que
// aria-describedby funcione aunque la burbuja esté cerrada.
//
// `tone="light"`: burbuja neutral-100 con texto neutral-800 y sombra
// shadow-control, para leer texto largo (las descripciones de paso
// cortadas). `className` reemplaza el display del envoltorio (inline-flex)
// cuando el elemento tiene que ocupar su ancho, como un párrafo.
// `disabled`: no se abre. Para apagarlo sin desmontar el envoltorio (y
// con él al hijo, que perdería su ref).

// Separación entre la punta de la flecha y el elemento (spacing-8), alto
// de la flecha (spacing-4) y margen con el borde de la pantalla
// (spacing-16), en px para el cálculo de posición.
const GAP = 8;
const ARROW = 4;
const EDGE = 16;

type Placement = { top: number; left: number; arrowLeft: number; below: boolean };

export default function Tooltip({
  content,
  children,
  focusable = false,
  id,
  tone = "dark",
  className = "inline-flex",
  disabled = false,
}: {
  content: string;
  children: ReactNode;
  focusable?: boolean;
  id?: string;
  tone?: "dark" | "light";
  className?: string;
  disabled?: boolean;
}) {
  const bubbleTone =
    tone === "light" ? "bg-neutral-100 text-neutral-800 shadow-control" : "bg-neutral-800 text-neutral-100";
  const arrowTone = tone === "light" ? "bg-neutral-100" : "bg-neutral-800";
  const generatedId = useId();
  const tipId = id ?? generatedId;
  const triggerRef = useRef<HTMLSpanElement>(null);
  const bubbleRef = useRef<HTMLSpanElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPointer = useRef<string>("mouse");
  // open: debe verse. mounted: existe en el DOM (también mientras se va).
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [placement, setPlacement] = useState<Placement | null>(null);

  const cancelClose = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }, []);

  const show = useCallback(() => {
    if (disabled) return;
    cancelClose();
    setMounted(true);
    setOpen(true);
  }, [cancelClose, disabled]);

  // Fundido de salida (150ms, el mismo que duration-150) y desmontaje.
  const hide = useCallback(() => {
    cancelClose();
    setOpen(false);
    closeTimer.current = setTimeout(() => {
      setMounted(false);
      setPlacement(null);
    }, 150);
  }, [cancelClose]);

  // Posición: se mide la burbuja ya pintada (invisible) y se coloca.
  useLayoutEffect(() => {
    if (!mounted || placement) return;
    const trigger = triggerRef.current;
    const bubble = bubbleRef.current;
    if (!trigger || !bubble) return;
    const t = trigger.getBoundingClientRect();
    const b = bubble.getBoundingClientRect();
    const center = t.left + t.width / 2;
    const left = Math.min(
      Math.max(center - b.width / 2, EDGE),
      window.innerWidth - EDGE - b.width
    );
    const above = t.top - GAP - ARROW - b.height;
    const below = above < EDGE;
    setPlacement({
      top: below ? t.bottom + GAP + ARROW : above,
      left,
      arrowLeft: center - left,
      below,
    });
  }, [mounted, placement]);

  // Abierto: Escape, toque fuera, scroll o resize lo cierran.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") hide();
    }
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || bubbleRef.current?.contains(target)) return;
      hide();
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [open, hide]);

  // Control que contiene el elemento y recibe el foco por él (data-tip-anchor).
  useEffect(() => {
    const anchor = triggerRef.current?.closest<HTMLElement>("[data-tip-anchor]");
    if (!anchor || focusable) return;
    function onFocus() {
      if (anchor!.matches(":focus-visible")) show();
    }
    anchor.addEventListener("focus", onFocus);
    anchor.addEventListener("blur", hide);
    return () => {
      anchor.removeEventListener("focus", onFocus);
      anchor.removeEventListener("blur", hide);
    };
  }, [focusable, show, hide]);

  useEffect(() => cancelClose, [cancelClose]);

  return (
    <span
      ref={triggerRef}
      tabIndex={focusable ? 0 : undefined}
      aria-describedby={focusable ? tipId : undefined}
      onPointerDown={(e) => {
        lastPointer.current = e.pointerType;
      }}
      onPointerEnter={(e) => {
        if (e.pointerType === "mouse") show();
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === "mouse") hide();
      }}
      onFocus={(e) => {
        if (focusable && e.currentTarget.matches(":focus-visible")) show();
      }}
      onBlur={() => {
        if (focusable) hide();
      }}
      onClick={(e) => {
        if (lastPointer.current !== "touch") return;
        // Toque: abre o cierra, y no activa el control que lo contiene.
        e.preventDefault();
        e.stopPropagation();
        if (open) hide();
        else show();
      }}
      className={className}
    >
      {children}
      {/* hidden: fuera del nombre accesible del control que lo contiene,
          pero aria-describedby sí lee el texto de elementos ocultos. */}
      <span id={tipId} hidden>
        {content}
      </span>
      {mounted &&
        createPortal(
          <span
            ref={bubbleRef}
            aria-hidden="true"
            style={placement ? { top: placement.top, left: placement.left } : { top: 0, left: 0 }}
            // Se pinta invisible y a opacidad 0 para medirla; al colocarla
            // entra en 300ms y, al cerrarse, sale en 150ms.
            className={`fixed z-50 block w-max max-w-tooltip rounded-md p-8 text-left font-body text-small font-regular normal-case leading-sm tracking-normal transition-opacity ${bubbleTone} motion-reduce:transition-none ${
              !placement
                ? "invisible opacity-0"
                : open
                  ? "opacity-100 duration-300"
                  : "pointer-events-none opacity-0 duration-150"
            }`}
          >
            {content}
            {/* Flecha: triángulo de 8×4 (spacing-8 × spacing-4). */}
            <span
              style={{ left: placement?.arrowLeft ?? 0 }}
              className={`absolute h-4 w-8 -translate-x-1/2 ${arrowTone} ${
                placement?.below
                  ? "bottom-full [clip-path:polygon(50%_0,100%_100%,0_100%)]"
                  : "top-full [clip-path:polygon(0_0,100%_0,50%_100%)]"
              }`}
            />
          </span>,
          document.body
        )}
    </span>
  );
}
