"use client";

import { useState } from "react";

interface StepAction {
  order: number;
  type: string;
  description: string;
  targetElement: string;
  value?: string;
}

interface StepPrediction {
  imaginedState: string;
  predictedFriction: number;
  frictionReason: string;
  confidence: number;
}

interface StepVerification {
  executed: boolean;
  stateChanged: boolean;
  actualUrl: string;
  actualTitle: string;
  screenshot: string;
  predictionMatch: number;
  realFriction: number;
  discrepancy: string;
}

interface WhatIfStep {
  action: StepAction;
  prediction: StepPrediction;
  verification?: StepVerification;
}

interface WhatIfJourney {
  url: string;
  question: string;
  intent: string;
  userProfile: string;
  steps: WhatIfStep[];
  outcome: "completed" | "blocked" | "partial";
  summary: string;
  truncated: boolean;
}

const profileLabels: Record<string, string> = {
  new: "First-time visitor",
  returning: "Returning user",
  rushed: "In a hurry",
  explorer: "Just browsing",
};

const outcomeStyles: Record<string, { label: string; color: string }> = {
  completed: { label: "Completed", color: "text-green-400" },
  partial: { label: "Partially completed", color: "text-yellow-400" },
  blocked: { label: "Blocked", color: "text-red-400" },
};

const EXAMPLE_QUESTIONS = [
  "What happens if I try to sign up?",
  "What if I search for something specific?",
  "What happens if I try to contact support?",
];

function StepCard({ step, isLast }: { step: WhatIfStep; isLast: boolean }) {
  const v = step.verification;
  const failed = v && !v.executed;
  const noResponse = v && v.executed && !v.stateChanged;
  const friction = v?.realFriction ?? 0;

  let dotColor = "bg-gray-text";
  let statusText = "Not executed";

  if (failed) {
    dotColor = "bg-gray-500";
    statusText = "Could not execute";
  } else if (noResponse) {
    dotColor = "bg-yellow-400";
    statusText = "No response from page";
  } else if (v && friction >= 0.5) {
    dotColor = "bg-yellow-400";
    statusText = "Friction detected";
  } else if (v) {
    dotColor = "bg-green-400";
    statusText = "Smooth";
  }

  return (
    <div className="relative pl-8 pb-8">
      {!isLast && (
        <div className="absolute left-[5px] top-4 bottom-0 w-px bg-dark-border" />
      )}
      <div className={`absolute left-0 top-1.5 w-[11px] h-[11px] rounded-full ${dotColor}`} />

      <div className="mb-1 flex items-baseline gap-3">
        <span className="text-xs text-gray-text">Step {step.action.order}</span>
        <span className="text-xs text-gray-text">{statusText}</span>
      </div>

      <p className="text-white text-sm mb-3">{step.action.description}</p>

      <div className="space-y-3 text-sm">
        <div>
          <div className="text-xs uppercase tracking-wide text-gray-text mb-1">
            Spector expected
          </div>
          <p className="text-gray-text text-xs leading-relaxed">
            {step.prediction.imaginedState}
          </p>
        </div>

        {v && v.executed && (
          <div>
            <div className="text-xs uppercase tracking-wide text-gray-text mb-1">
              What happened
            </div>
            <p className="text-gray-text text-xs leading-relaxed mb-2">
              {v.discrepancy === "match"
                ? "The prediction matched reality."
                : v.discrepancy}
            </p>
            <p className="text-xs text-gray-text">
              Landed on: <span className="text-cyan">{v.actualTitle}</span>
            </p>
          </div>
        )}

        {failed && (
          <p className="text-xs text-gray-text italic">
            Spector couldn&apos;t locate or interact with this element.
          </p>
        )}

        {v?.screenshot && v.executed && (
          <img
            src={v.screenshot}
            alt={`Step ${step.action.order}`}
            className="rounded border border-dark-border w-full mt-2"
            style={{ maxHeight: "260px", objectFit: "cover", objectPosition: "top" }}
          />
        )}
      </div>
    </div>
  );
}

export default function WhatIfPanel({ url }: { url: string }) {
  const [question, setQuestion] = useState("");
  const [journey, setJourney] = useState<WhatIfJourney | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function simulate(q: string) {
    if (!q.trim()) return;

    setLoading(true);
    setError("");
    setJourney(null);

    try {
      const response = await fetch("/api/whatif", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, question: q.trim() }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Simulation failed");
        return;
      }

      setJourney(data);
    } catch {
      setError("Could not connect to the server");
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    simulate(question);
  }

  return (
    <section className="mt-16 pt-10 border-t border-dark-border">
      <h3 className="font-heading text-sm uppercase tracking-widest text-gray-text mb-2">
        Ask a what-if question
      </h3>
      <p className="text-xs text-gray-text mb-5">
        Spector will simulate the journey and then walk it in a real browser.
      </p>

      <form onSubmit={handleSubmit} className="mb-4">
        <div className="flex gap-2">
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="What happens if..."
            disabled={loading}
            className="flex-1 h-11 px-4 rounded-lg bg-dark-card border border-dark-border text-white placeholder:text-gray-text focus:outline-none focus:border-cyan transition-colors text-sm disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={loading || !question.trim()}
            className="h-11 px-5 rounded-lg bg-cyan text-dark font-heading font-semibold text-sm hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? "Simulating..." : "Simulate"}
          </button>
        </div>
      </form>

      {!journey && !loading && (
        <div className="flex flex-wrap gap-2 mb-6">
          {EXAMPLE_QUESTIONS.map((q) => (
            <button
              key={q}
              onClick={() => {
                setQuestion(q);
                simulate(q);
              }}
              className="text-xs px-3 py-1.5 rounded-full border border-dark-border text-gray-text hover:border-cyan hover:text-cyan transition-colors cursor-pointer"
            >
              {q}
            </button>
          ))}
        </div>
      )}

      {error && <p className="text-sm text-red-400 mb-4">{error}</p>}

      {loading && (
        <div className="flex items-center gap-3 py-10">
          <div className="w-5 h-5 border-2 border-dark-border border-t-cyan rounded-full animate-spin" />
          <span className="text-sm text-gray-text">
            Walking the journey in a real browser...
          </span>
        </div>
      )}

      {journey && (
        <div className="mt-6">
          <div className="rounded-lg border border-dark-border bg-dark-card p-5 mb-8">
            <div className="flex items-baseline gap-3 mb-2">
              <span className={`text-sm font-semibold ${outcomeStyles[journey.outcome].color}`}>
                {outcomeStyles[journey.outcome].label}
              </span>
              <span className="text-xs text-gray-text">
                as a {profileLabels[journey.userProfile] || journey.userProfile}
              </span>
            </div>
            <p className="text-white text-sm leading-relaxed">{journey.summary}</p>
            {journey.truncated && (
              <p className="text-xs text-gray-text mt-3 italic">
                This journey was longer than four steps. Spector simulated the first four.
              </p>
            )}
          </div>

          {journey.steps.length > 0 && (
            <div>
              {journey.steps.map((step, i) => (
                <StepCard
                  key={i}
                  step={step}
                  isLast={i === journey.steps.length - 1}
                />
              ))}
            </div>
          )}

          <button
            onClick={() => {
              setJourney(null);
              setQuestion("");
            }}
            className="text-xs text-gray-text hover:text-cyan transition-colors"
          >
            Ask another question
          </button>
        </div>
      )}
    </section>
  );
}