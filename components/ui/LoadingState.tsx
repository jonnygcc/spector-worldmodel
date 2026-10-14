"use client";

import { useEffect, useState } from "react";

const STAGES = [
  "Loading the page...",
  "Finding routes toward your goal...",
  "Simulating each route...",
  "Walking the top routes in a real browser...",
  "Comparing what happened...",
];

export default function LoadingState() {
  const [stage, setStage] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setStage(1), 6000),
      setTimeout(() => setStage(2), 20000),
      setTimeout(() => setStage(3), 45000),
      setTimeout(() => setStage(4), 90000),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <div className="flex flex-col items-center justify-center py-28">
      <div className="w-10 h-10 border-4 border-dark-border border-t-cyan rounded-full animate-spin mb-6" />
      <p className="text-white text-sm mb-2">{STAGES[stage]}</p>
      <p className="text-gray-text text-xs">This usually takes a minute or two</p>
    </div>
  );
}