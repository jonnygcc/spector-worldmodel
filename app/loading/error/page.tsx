import { notFound } from "next/navigation";
import LoadError from "@/components/loading/LoadError";

// Preview route for the analysis error state; see app/loading/page.tsx.
export default function LoadErrorPreview() {
  // Sample data: in production a user typing this URL would see an invented error.
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <section className="flex flex-col items-center px-16 py-48 lg:px-24 lg:py-140">
      <LoadError />
    </section>
  );
}
