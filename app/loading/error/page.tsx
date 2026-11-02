import LoadError from "@/components/loading/LoadError";

// Estado de error de la pantalla de análisis (frame Desktop/Loading – error).
// Ruta de preview, como /loading: ver el comentario en app/loading/page.tsx.
export default function LoadErrorPreview() {
  return (
    <section className="flex flex-col items-center px-16 py-48 lg:px-24 lg:py-140">
      <LoadError />
    </section>
  );
}
