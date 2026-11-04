import { useId } from "react";

// Copied from Paper's Desktop/Home frame; 32×23 is the SVG's own size, not a layout measure.
export default function SpectorLogo({ className }: { className?: string }) {
  const maskId = useId();

  return (
    <svg
      width="32"
      height="23"
      viewBox="0 0 32 23"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={className}
    >
      <mask id={maskId} style={{ maskType: "alpha" }} maskUnits="userSpaceOnUse" x="0" y="0" width="32" height="23">
        <rect width="32" height="22.4" rx="3.84" fill="#000" />
      </mask>
      <g mask={`url(#${maskId})`}>
        <rect width="32" height="23" fill="var(--color-neutral-800)" />
        <path
          d="M20.4 -3.199C9.28 4.001 11.151 9.079 14.64 9.681C16.96 10.081 17.36 9.02 19.6 9.281C21.84 9.541 23.6 12.235 20.56 15.841C17.12 19.921 14.96 21.921 9.92 24.881"
          stroke="var(--color-neutral-100)"
          strokeWidth="3.84"
        />
      </g>
    </svg>
  );
}
