import { pathNumber } from "./pathSteps";
import type { Step } from "./sample";

// Número de un paso en la tira y en el visor:
// - accent con número neutral-100: paso alcanzado.
// - neutral-200 con número neutral-600: paso no alcanzado (donde la ruta
//   se detuvo y lo que sigue). Va antes que danger: el paso que falló en
//   una ruta bloqueada es justo donde se detuvo.
// - danger: paso que falló dentro del tramo alcanzado.
export default function StepNumber({ steps, index }: { steps: Step[]; index: number }) {
  const step = steps[index];
  const tone = step.unreached
    ? "bg-neutral-200 text-neutral-600"
    : `text-neutral-100 ${step.failed ? "bg-danger" : "bg-accent"}`;
  return (
    <span
      className={`relative rounded-sm p-4 font-body text-label font-semibold leading-sm tabular-nums ${tone}`}
    >
      {pathNumber(index)}
    </span>
  );
}
