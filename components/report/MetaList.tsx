const META = "font-heading text-label font-medium uppercase leading-rg tracking-wide";

// Un dato de la meta: texto suelto ("OCT 16, 2026") o con etiqueta
// ("MODEL GPT-5.5", la etiqueta en neutral-500 y a spacing-4 del valor).
export type MetaItem = string | { label: string; value: string };

// Metadatos en una fila, separados por puntos (cabecera del reporte y
// eyebrows de sección).
export default function MetaList({ items }: { items: MetaItem[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-8">
      {items.map((item, i) => (
        <li key={i} className="flex items-center gap-8">
          {/* SIN TOKEN: punto separador de 3×3. */}
          {i > 0 && <span aria-hidden="true" className="size-[3px] rounded-full bg-neutral-200" />}
          {typeof item === "string" ? (
            <span className={`${META} tabular-nums text-neutral-600`}>{item}</span>
          ) : (
            <span className="flex items-center gap-4">
              <span className={`${META} text-neutral-500`}>{item.label}</span>
              <span className={`${META} tabular-nums text-neutral-600`}>{item.value}</span>
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
