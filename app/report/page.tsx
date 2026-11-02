import ReportHeader from "@/components/report/ReportHeader";
import ReportSection from "@/components/report/ReportSection";
import ReportTable from "@/components/report/ReportTable";
import WorldModelSection from "@/components/report/WorldModelSection";
import { WORLD_MODEL_SAMPLE } from "@/components/report/worldModelSample";
import { REPORT, ROUTES } from "@/components/report/sample";

// Pantalla Reporte (frames Desktop/Reporte, Reporte – blocked y
// Reporte/World Model), con datos de ejemplo fijos. Ruta de preview, como
// /loading y /loading/error: ver el comentario en app/loading/page.tsx.
//
// Dos secciones con la misma tabla: Agent (rutas medidas en el navegador)
// y World Model (escenarios predichos desde el primer estado capturado,
// sin navegar, hacia el mismo objetivo). spacing-48 entre secciones.
export default function ReportPreview() {
  return (
    <section className="flex flex-col items-start gap-24 px-16 pb-48 pt-32 lg:gap-32 lg:px-24 lg:py-64">
      <ReportHeader
        url={REPORT.url}
        goal={REPORT.goal}
        meta={[REPORT.date, { label: "Model", value: REPORT.model }]}
      />
      <div className="flex w-full flex-col gap-48">
        <ReportSection
          mode="agent"
          meta={[`${REPORT.executed} routes executed`, `${REPORT.profiles} profiles`]}
        >
          <ReportTable routes={ROUTES} id="agent" />
        </ReportSection>
        <WorldModelSection state={{ status: "ready", scenarios: WORLD_MODEL_SAMPLE }} />
      </div>
    </section>
  );
}
