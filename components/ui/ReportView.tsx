"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import ReportCard from "./ReportCard";
import LoadingState from "./LoadingState";

interface Finding {
  title: string;
  description: string;
  severity: "high" | "medium" | "low";
  step: string;
}

export default function ReportView() {
  const searchParams = useSearchParams();
  const url = searchParams.get("url");

  const [findings, setFindings] = useState<Finding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!url) {
      setError("No URL provided");
      setLoading(false);
      return;
    }

    async function analyze() {
      try {
        const response = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
        });

        const data = await response.json();

        if (!response.ok) {
          setError(data.error || "Analysis failed");
          return;
        }

        setFindings(data.findings);
      } catch {
        setError("Could not connect to the server");
      } finally {
        setLoading(false);
      }
    }

    analyze();
  }, [url]);

  if (loading) return <LoadingState />;

  if (error) {
    return (
      <div className="text-center py-20">
        <p className="text-red-400 mb-2">{error}</p>
        <a href="/" className="text-cyan text-sm hover:underline">Try another URL</a>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-8">
        <a href="/" className="text-sm text-gray-text hover:text-cyan transition-colors">
          ← Back to home
        </a>
        <h2 className="font-heading text-3xl font-bold mt-4 mb-1">
          Analysis Report
        </h2>
        <p className="text-gray-text text-sm">
          Simulated UX journey for:{" "}
          <span className="text-cyan">{url}</span>
        </p>
        <p className="text-gray-text text-xs mt-1">
          {findings.length} issue{findings.length !== 1 && "s"} found
        </p>
      </div>

      <div className="grid gap-4">
        {findings.map((finding, index) => (
          <ReportCard key={index} {...finding} />
        ))}
      </div>
    </div>
  );
}