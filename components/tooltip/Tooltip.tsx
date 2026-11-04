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

// Rendered in a fixed portal so overflow containers can't clip it; the text lives in a hidden span
// so aria-describedby works while closed. `disabled` keeps the wrapper mounted (the child keeps its ref).

// Arrow gap (spacing-8), arrow height (spacing-4) and screen margin (spacing-16), in px for positioning.
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
  // open: should be visible. mounted: in the DOM, also while fading out.
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

  // Fade-out (150ms, same as duration-150), then unmount.
  const hide = useCallback(() => {
    cancelClose();
    setOpen(false);
    closeTimer.current = setTimeout(() => {
      setMounted(false);
      setPlacement(null);
    }, 150);
  }, [cancelClose]);

  // Measure the bubble once painted (invisible), then place it.
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

  // While open: Escape, an outside tap, scroll or resize close it.
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

  // Control that contains the element and takes focus on its behalf (data-tip-anchor).
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
        // Tap: toggles, without activating the containing control.
        e.preventDefault();
        e.stopPropagation();
        if (open) hide();
        else show();
      }}
      className={className}
    >
      {children}
      {/* hidden keeps it out of the control's accessible name; aria-describedby still reads hidden text. */}
      <span id={tipId} hidden>
        {content}
      </span>
      {mounted &&
        createPortal(
          <span
            ref={bubbleRef}
            aria-hidden="true"
            style={placement ? { top: placement.top, left: placement.left } : { top: 0, left: 0 }}
            // Painted invisible at opacity 0 to measure it; fades in over 300ms and out over 150ms.
            className={`fixed z-50 block w-max max-w-tooltip rounded-md p-8 text-left font-body text-small font-regular normal-case leading-sm tracking-normal transition-opacity ${bubbleTone} motion-reduce:transition-none ${
              !placement
                ? "invisible opacity-0"
                : open
                  ? "opacity-100 duration-300"
                  : "pointer-events-none opacity-0 duration-150"
            }`}
          >
            {content}
            {/* Arrow: 8×4 triangle (spacing-8 × spacing-4). */}
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
