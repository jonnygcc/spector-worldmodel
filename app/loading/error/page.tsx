import LoadError from "@/components/loading/LoadError";

// Preview route for the analysis error state; see app/loading/page.tsx.
export default function LoadErrorPreview() {
  return (
    <section className="flex flex-col items-center px-16 py-48 lg:px-24 lg:py-140">
      <LoadError />
    </section>
  );
}
