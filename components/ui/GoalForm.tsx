"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const GOAL_OPTIONS = [
  { id: "signup", label: "Sign up", hint: "Create an account" },
  { id: "purchase", label: "Buy something", hint: "Find and purchase" },
  { id: "find_info", label: "Find information", hint: "Pricing, docs, answers" },
  { id: "contact", label: "Contact support", hint: "Reach a human" },
  { id: "explore", label: "Explore the product", hint: "Understand what it does" },
  { id: "general_scan", label: "General scan", hint: "No specific goal" },
];

export default function GoalForm() {
  const router = useRouter();

  const [url, setUrl] = useState("");
  const [goalId, setGoalId] = useState("signup");
  const [personaMode, setPersonaMode] = useState<"automatic" | "personal">("automatic");
  const [customPersona, setCustomPersona] = useState("");
  const [error, setError] = useState("");

  function isValidUrl(value: string) {
    try {
      new URL(value);
      return true;
    } catch {
      return false;
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!url.trim()) {
      setError("Paste a URL to analyze");
      return;
    }

    if (!isValidUrl(url)) {
      setError("Enter a valid URL (e.g. https://example.com)");
      return;
    }

    if (personaMode === "personal" && customPersona.trim().length < 10) {
      setError("Describe your user in a few more words");
      return;
    }

    const params = new URLSearchParams({
      url: url.trim(),
      goal: goalId,
      personaMode,
    });

    if (personaMode === "personal") {
      params.set("persona", customPersona.trim());
    }

    router.push(`/results?${params.toString()}`);
  }

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-xl text-left">
      {/* URL */}
      <div className="mb-8">
        <label className="block text-xs uppercase tracking-widest text-gray-text mb-3">
          Website
        </label>
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com"
          className="w-full h-12 px-4 rounded-lg bg-dark-card border border-dark-border text-white placeholder:text-gray-text focus:outline-none focus:border-cyan transition-colors"
        />
      </div>

      {/* GOAL */}
      <div className="mb-8">
        <label className="block text-xs uppercase tracking-widest text-gray-text mb-3">
          What do you want to test?
        </label>
        <div className="grid grid-cols-2 gap-2">
          {GOAL_OPTIONS.map((g) => {
            const selected = goalId === g.id;
            return (
              <button
                key={g.id}
                type="button"
                onClick={() => setGoalId(g.id)}
                className={`text-left px-4 py-3 rounded-lg border transition-colors cursor-pointer ${
                  selected
                    ? "border-cyan bg-cyan/5"
                    : "border-dark-border bg-dark-card hover:border-gray-text"
                }`}
              >
                <div className={`text-sm font-medium ${selected ? "text-cyan" : "text-white"}`}>
                  {g.label}
                </div>
                <div className="text-xs text-gray-text mt-0.5">{g.hint}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* PERSONA */}
      <div className="mb-8">
        <label className="block text-xs uppercase tracking-widest text-gray-text mb-3">
          Who is the user?
        </label>

        <div className="inline-flex rounded-lg border border-dark-border bg-dark-card p-1 mb-3">
          <button
            type="button"
            onClick={() => setPersonaMode("automatic")}
            className={`px-4 py-1.5 rounded text-sm transition-colors cursor-pointer ${
              personaMode === "automatic"
                ? "bg-cyan text-dark font-medium"
                : "text-gray-text hover:text-white"
            }`}
          >
            Automatic
          </button>
          <button
            type="button"
            onClick={() => setPersonaMode("personal")}
            className={`px-4 py-1.5 rounded text-sm transition-colors cursor-pointer ${
              personaMode === "personal"
                ? "bg-cyan text-dark font-medium"
                : "text-gray-text hover:text-white"
            }`}
          >
            Personal
          </button>
        </div>

        {personaMode === "automatic" ? (
          <p className="text-xs text-gray-text">
            Spector picks the user profile that best fits your goal.
          </p>
        ) : (
          <textarea
            value={customPersona}
            onChange={(e) => setCustomPersona(e.target.value)}
            placeholder="A 55 year old restaurant owner, not comfortable with technology, browsing on an old phone..."
            rows={3}
            className="w-full px-4 py-3 rounded-lg bg-dark-card border border-dark-border text-white placeholder:text-gray-text focus:outline-none focus:border-cyan transition-colors text-sm resize-none"
          />
        )}
      </div>

      {error && <p className="text-sm text-red-400 mb-4">{error}</p>}

      <button
        type="submit"
        className="w-full h-12 rounded-lg bg-cyan text-dark font-heading font-semibold hover:opacity-90 transition-opacity cursor-pointer"
      >
        Analyze
      </button>
    </form>
  );
}