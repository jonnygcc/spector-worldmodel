import { LoaderCircle, Search } from "lucide-react";

// Acción principal de la barra: azul sobre fondo neutro (regla de botones
// del sistema). 24×24 con icono de 16. Deshabilitado sin URL válida; con
// spinner mientras el análisis arranca.
export default function SubmitButton({
  disabled = false,
  pending = false,
}: {
  disabled?: boolean;
  pending?: boolean;
}) {
  return (
    <button
      type="submit"
      aria-label={pending ? "Analyzing" : "Analyze"}
      // Mientras corre no se deshabilita con `disabled` para que siga azul
      // con el spinner; la barra ignora el envío (aria-busy).
      disabled={disabled && !pending}
      aria-busy={pending}
      className="flex size-24 shrink-0 cursor-pointer items-center justify-center rounded-full bg-accent p-4 text-neutral-100 transition-colors duration-150 hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-neutral-300 disabled:hover:bg-neutral-300 aria-busy:cursor-wait"
    >
      {pending ? (
        <LoaderCircle aria-hidden="true" className="size-16 animate-spin" />
      ) : (
        <Search aria-hidden="true" className="size-16" />
      )}
    </button>
  );
}
