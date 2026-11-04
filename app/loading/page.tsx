import { Suspense } from "react";
import StageList from "@/components/loading/StageList";
import { STAGE_IDS, type StageId } from "@/components/loading/stages";

// Preview route with sample data; the real flow lives in AnalysisScreen. ?stage=<id> pins
// the active stage (load, profiles, find, simulate, browser, compare).
export default function Loading({
  searchParams,
}: {
  searchParams: Promise<{ stage?: string }>;
}) {
  return (
    <section className="flex flex-1 flex-col items-center justify-center px-16 py-48 lg:flex-none lg:justify-start lg:px-24 lg:py-140">
      <div className="flex w-full max-w-narrow justify-center">
        {/* searchParams is request data: with cacheComponents it's read inside Suspense so the rest prerenders. */}
        <Suspense fallback={<StageList />}>
          <PreviewStage searchParams={searchParams} />
        </Suspense>
      </div>
    </section>
  );
}

async function PreviewStage({ searchParams }: { searchParams: Promise<{ stage?: string }> }) {
  const { stage } = await searchParams;
  const active = STAGE_IDS.includes(stage as StageId) ? (stage as StageId) : undefined;
  return <StageList active={active} />;
}
