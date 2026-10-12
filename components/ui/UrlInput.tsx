"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function UrlInput() {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const router = useRouter();

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

    router.push(`/results?url=${encodeURIComponent(url)}`);
  }

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-xl">
      <div className="flex gap-2">
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com"
          className="flex-1 h-12 px-4 rounded-lg bg-dark-card border border-dark-border text-white placeholder:text-gray-text focus:outline-none focus:border-cyan transition-colors"
        />
        <button
          type="submit"
          className="h-12 px-6 rounded-lg bg-cyan text-dark font-heading font-semibold hover:opacity-90 transition-opacity cursor-pointer"
        >
          Analyze
        </button>
      </div>
      {error && (
        <p className="mt-2 text-sm text-red-400">{error}</p>
      )}
    </form>
  );
}