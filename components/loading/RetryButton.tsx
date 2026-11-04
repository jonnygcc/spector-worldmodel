"use client";

import { useEffect, useState } from "react";

// Botón de reintentar que solo se ofrece cuando reintentar sirve (paso 9):
// - `retryable` false (p. ej. la cuota diaria agotada): no se dibuja; el
//   mensaje ya dice qué hacer.
// - `retryAfterSeconds`: deshabilitado con la cuenta atrás ("Retry in
//   37s"), y se habilita al llegar a cero. Reintentar antes contra una
//   cuota agotada siempre falla.
// Quien lo usa le pasa una `key` nueva en cada error para reiniciar la
// cuenta.
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
