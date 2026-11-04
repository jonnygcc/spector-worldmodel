"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import ScreenshotViewer from "./ScreenshotViewer";
import { ARROW } from "./arrow";
import Tooltip from "@/components/tooltip/Tooltip";
import StepNumber from "./StepNumber";
import type { Step } from "./sample";

// NO TOKEN — screenshot measures, all from the frame.
const THUMB_W = "w-[200px]"; // screenshot width, and each step's
const THUMB = `${THUMB_W} h-[125px]`; // 200×125 screenshot
const THUMB_ROW = "h-[125px]"; // screenshot row height, to center the arrows
// With overflow-x: auto, overflow-y can't be visible; this inner padding keeps the cards'
// top border from being clipped.
const RAIL_PAD = "pb-[2px] pt-[6px] px-16 lg:pl-[3px]";
const ARROW_TOP = "top-[6px]"; // the arrows drop as much as the screenshots
// Page skeleton inside the screenshot slot, a placeholder for steps without one.
const BAR = "rounded-[1px] bg-neutral-200";

// The design's spring (stiffness 200, damping 40, mass 1) is overdamped, so 500ms with this
// cubic-bezier approximates it: fast start, soft stop.
const SCROLL_DURATION = 500;
const scrollEase = cubicBezier(0.22, 1, 0.36, 1);

// Same semantics as CSS cubic-bezier: time progress (x) → movement progress (y). Solves x(t)
// with Newton, falling back to bisection.
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

// No global focus ring: it would sit outside the box and get clipped by the strip's scroll,
// so only the 1px border turns accent.
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
  const border = failed ? "border-danger" : "border-neutral-200";

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={screenshot ? `Open screenshot: ${label}` : `Open step: ${label}`}
      className={`group/thumb shrink-0 cursor-zoom-in rounded-sm focus-visible:outline-none ${THUMB}`}
    >
      {screenshot ? (
        // A JPEG data URL: next/image has nothing to optimize.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={screenshot}
          alt=""
          className={`size-full rounded-sm border bg-neutral-100 object-cover object-top ${border} ${FOCUS}`}
        />
      ) : simulated ? (
        // Predicted steps never ran: "Predicted" instead of a skeleton that looks like a failed load.
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

// Clamped to 3 lines; the tooltip only appears when the text is actually cut. The full text stays
// in the DOM, so screen readers read all of it. `full` (World Model) never clamps.
function StepLabel({ step, full = false }: { step: Step; full?: boolean }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [clipped, setClipped] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setClipped(el.scrollHeight > el.clientHeight + 1);
    measure();
    // Before the font loads the text is shorter and isn't cut, and the ResizeObserver won't fire
    // because the box stays 3 lines tall, so measure again once fonts are ready.
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

  // Always wrapped, just disabled when not cut: toggling the wrapper would remount the paragraph
  // and leave the ResizeObserver watching the old node.
  return (
    <Tooltip content={step.label} tone="light" className="flex" disabled={!clipped}>
      {text}
    </Tooltip>
  );
}

// A segment is blue only between two reached steps, so the one entering the stop step is
// already gray. Steps that don't fit scroll with the arrows; a click opens ScreenshotViewer.
export default function StepStrip({
  steps,
  simulated = false,
}: {
  steps: Step[];
  // Not executed: every step is a "Predicted" box, never a screenshot.
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

  // Animated by hand: behavior "smooth" uses the browser's curve and Chrome drops it under reduced motion.
  // Each target chains from the previous one so the strip always stops aligned to a screenshot.
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
        // Native user scroll (touch, wheel, drag) cancels the arrow animation instead of fighting it.
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
