import { Suspense } from "react";
import ReportView from "@/components/ui/ReportView";
import LoadingState from "@/components/ui/LoadingState";

export default function Results() {
  return (
    <Suspense fallback={<LoadingState />}>
      <ReportView />
    </Suspense>
  );
}