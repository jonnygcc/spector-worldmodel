const META = "font-heading text-label font-medium uppercase leading-rg tracking-wide";

// Free text ("OCT 16, 2026") or labelled ("MODEL GPT-5.5", label in neutral-500).
export type MetaItem = string | { label: string; value: string };

// Used in the report header and in section eyebrows.
export default function MetaList({ items }: { items: MetaItem[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-8">
      {items.map((item, i) => (
        <li key={i} className="flex items-center gap-8">
          {/* NO TOKEN: 3×3 separator dot. */}
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
