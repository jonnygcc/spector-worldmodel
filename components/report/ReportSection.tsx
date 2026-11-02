import { BotMessageSquare, GlobeCheck } from "lucide-react";
import MetaList from "./MetaList";

const LABEL = "font-heading text-label font-medium leading-rg tracking-wide";

const MODE = {
  agent: { Icon: BotMessageSquare, name: "Agent", subtitle: "Measured route" },
  "world-model": { Icon: GlobeCheck, name: "World Model", subtitle: "Predicted detours, same goal" },
};

// Sección del reporte (frame Desktop/Reporte/World Model): eyebrow con el
// ícono y el nombre del modo, su subtítulo debajo y la meta a la derecha;
// luego la tabla y, si hay, una nota al pie.
//
// - Agent: robot, la ruta medida en el navegador.
// - World Model: mundo, escenarios predichos hacia el mismo objetivo.
//
// Separaciones: spacing-16 entre eyebrow, tabla y nota. En móvil la meta
// baja bajo el nombre (no hay frame Phone de esta pantalla).
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

      {/* La nota va discreta, en una línea gris. El frame la dibuja en una
          caja warning-10; se dejó así a pedido (ver PENDING-SYNC). */}
      {note && <p className="font-body text-small leading-lg text-neutral-600">{note}</p>}
    </section>
  );
}
