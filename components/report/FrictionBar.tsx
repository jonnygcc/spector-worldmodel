import type { Friction } from "./sample";

const FILL: Record<Friction, string> = {
  low: "bg-success",
  medium: "bg-accent",
  high: "bg-danger",
};

// Fricción de 0 a 100: barra de 100px con el relleno al porcentaje, y la
// cifra al lado. SIN TOKEN: el ancho de la pista (100px).
//
// Igual en Agent y World Model: que un escenario sea estimado ya lo dicen
// el "~" de time y steps y la nota al pie.
export default function FrictionBar({ value, level }: { value: number; level: Friction }) {
  return (
    <span className="flex items-center gap-8">
      <span className="flex h-4 w-[100px] shrink-0 rounded-sm bg-neutral-200">
        <span className={`h-4 rounded-sm ${FILL[level]}`} style={{ width: `${value}%` }} />
      </span>
      <span className="font-heading text-body leading-sm tabular-nums text-neutral-800">
        {value}
      </span>
    </span>
  );
}
