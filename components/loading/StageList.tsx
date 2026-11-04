"use client";

import { useState } from "react";
import { STAGES, type StageId } from "./stages";

export type { StageId };

const TOTAL = STAGES.length;
const LAPS = 3;
// Items of the middle lap: [TOTAL, 2 × TOTAL).
const MIDDLE = TOTAL;
// Center slot of the five visible items.
const CENTER = 2;

// Items outside the window also get 30% so they enter already faded when the list scrolls.
const OPACITY = ["", "opacity-50"];

const LABEL = "font-body text-body font-regular leading-rg text-neutral-800";

// Step between items H = h-stage (20px) + spacing-12 = 32px; the window shows five (148px).
const WINDOW = "h-[calc(var(--spacing-stage)*5+var(--spacing-12)*4)]";
const shift = (position: number) =>
  `translateY(calc(${CENTER - position} * (var(--spacing-stage) + var(--spacing-12))))`;

// Same position, mapped onto the middle lap.
const toMiddle = (position: number) => MIDDLE + (((position - MIDDLE) % TOTAL) + TOTAL) % TOTAL;

// Three identical laps scroll inside a five-item window, so wrapping from stage 6 to 1 keeps
// moving up; after the transition it snaps back to the middle lap with no visible jump.
export default function StageList({ active = "load" }: { active?: StageId }) {
  const activeIndex = Math.max(STAGES.findIndex((s) => s.id === active), 0);

  const [shown, setShown] = useState(activeIndex);
  const [position, setPosition] = useState(MIDDLE + activeIndex);
  const [animate, setAnimate] = useState(false);

  // Adjusted during render so position and transition change in the same frame.
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
