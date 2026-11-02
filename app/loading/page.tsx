import { Suspense } from "react";
import StageList from "@/components/loading/StageList";
import { STAGE_IDS, type StageId } from "@/components/loading/stages";

// Pantalla Loading (frame Desktop/Loading).
//
// RUTA DE PREVIEW, con datos de ejemplo. El análisis real vive en la Home
// (components/analysis/AnalysisScreen.tsx): Loading, Reporte y Error son
// estados de esa misma pantalla. /loading, /loading/error y /report se
// quedan para ver cada estado sin correr un análisis.
//
// ?stage=<id> fija la etapa activa (load, profiles, find, simulate,
// browser, compare) para revisar cada posición de la lista.
export default function Loading({
  searchParams,
}: {
  searchParams: Promise<{ stage?: string }>;
}) {
  return (
    <section className="flex flex-1 flex-col items-center justify-center px-16 py-48 lg:flex-none lg:justify-start lg:px-24 lg:py-140">
      <div className="flex w-full max-w-narrow justify-center">
        {/* searchParams es dato de la petición: con cacheComponents se lee
            dentro de Suspense para que el resto se prerenderice. Mientras
            tanto se ve la lista en la primera etapa. */}
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
