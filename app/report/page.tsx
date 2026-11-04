import ReportHeader from "@/components/report/ReportHeader";
import ReportSection from "@/components/report/ReportSection";
import ReportTable from "@/components/report/ReportTable";
import WorldModelSection from "@/components/report/WorldModelSection";
import { WORLD_MODEL_SAMPLE } from "@/components/report/worldModelSample";
import { REPORT, ROUTES } from "@/components/report/sample";

// Preview route with fixed sample data (see app/loading/page.tsx).
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
