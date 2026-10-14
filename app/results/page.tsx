import { Suspense } from "react";
import GoalReport from "@/components/ui/GoalReport";
import LoadingState from "@/components/ui/LoadingState";

export default function Results() {
  return (
    <Suspense fallback={<LoadingState />}>
      <GoalReport />
    </Suspense>
  );
}