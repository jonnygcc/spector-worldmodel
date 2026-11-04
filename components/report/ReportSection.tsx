import { BotMessageSquare, GlobeCheck } from "lucide-react";
import MetaList from "./MetaList";

const LABEL = "font-heading text-label font-medium leading-rg tracking-wide";

const MODE = {
  agent: { Icon: BotMessageSquare, name: "Agent", subtitle: "Measured route" },
  "world-model": { Icon: GlobeCheck, name: "World Model", subtitle: "Predicted detours, same goal" },
};

// On mobile the meta drops below the name (there's no Phone frame for this screen).
export default function ReportSection({
  mode,
  meta,
  note,
  children,
}: {
  mode: keyof typeof MODE;
  meta: string[];
  note?: string;
  children: React.ReactNode;
}) {
  const { Icon, name, subtitle } = MODE[mode];
  return (
    <section aria-label={name} className="flex w-full flex-col gap-16">
      <div className="flex flex-col items-start gap-8 lg:flex-row lg:items-end lg:gap-32">
        <div className="flex flex-col gap-8 lg:flex-1">
          <h2 className={`flex items-center gap-4 uppercase text-neutral-800 ${LABEL}`}>
            <Icon aria-hidden="true" className="size-16 shrink-0" />
            {name}
          </h2>
          <p className={`text-neutral-600 ${LABEL}`}>{subtitle}</p>
        </div>
        <MetaList items={meta} />
      </div>

      {children}

      {/* The frame draws the note in a warning-10 box; kept as a plain gray line on request (see PENDING-SYNC). */}
      {note && <p className="font-body text-small leading-lg text-neutral-600">{note}</p>}
    </section>
  );
}
