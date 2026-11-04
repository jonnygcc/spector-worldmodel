"use client";

import { useEffect, useState } from "react";

// Hidden when retrying can't help (e.g. daily quota); with retryAfterSeconds it counts down first.
// Callers pass a new `key` per error to restart the countdown.
export default function RetryButton({
  label,
  onRetry,
  retryable = true,
  retryAfterSeconds = 0,
  className,
}: {
  label: string;
  onRetry?: () => void;
  retryable?: boolean;
  retryAfterSeconds?: number;
  className: string;
}) {
  const [remaining, setRemaining] = useState(Math.max(0, Math.ceil(retryAfterSeconds)));

  useEffect(() => {
    if (remaining <= 0) return;
    const timer = setTimeout(() => setRemaining((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [remaining]);

  if (!retryable) return null;
  const waiting = remaining > 0;
  return (
    <button
      type="button"
      onClick={waiting ? undefined : onRetry}
      disabled={waiting}
      aria-live="polite"
      className={`${className} disabled:cursor-not-allowed disabled:opacity-60`}
    >
      {waiting ? `${label} in ${remaining}s` : label}
    </button>
  );
}
