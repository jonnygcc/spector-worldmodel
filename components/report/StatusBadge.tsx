import Tooltip from "@/components/tooltip/Tooltip";
import type { Status } from "./sample";

const STYLE: Record<Status, string> = {
  recommended: "bg-success-10 text-success",
  executed: "bg-accent-10 text-accent",
  blocked: "bg-danger-10 text-danger",
  unreachable: "bg-warning-10 text-warning",
  success: "bg-success-10 text-success",
  friction: "bg-warning-10 text-warning",
};

const MEANING: Record<Status, string> = {
  recommended: "The route with the least friction that reached the goal.",
  executed: "Ran in a real browser.",
  blocked: "The site stopped this route before it reached the goal.",
  unreachable: "No path to the goal was found, even after re-planning.",
  success: "Predicted to reach the goal.",
  friction: "Predicted to reach the goal, with friction along the way.",
};

// Un mismo estado se lee distinto según de dónde viene: BLOCKED de un
// escenario del World Model es una predicción, no lo que pasó.
const PREDICTED_BLOCKED = "Predicted to stop before the goal.";

// Estado de la ruta: RECOMMENDED (verde), EXECUTED (azul), BLOCKED (rojo:
// el sitio la detuvo), UNREACHABLE (ámbar: no encontró camino tras
// replanificar). Cada uno
// explica qué significa en un tooltip. El badge vive dentro del botón de
// la fila, así que no es enfocable: `tooltipId` permite que la fila lo
// enlace con aria-describedby y lo muestre al recibir el foco.
export default function StatusBadge({
  status,
  tooltipId,
  predicted = false,
}: {
  status: Status;
  tooltipId?: string;
  predicted?: boolean;
}) {
  const meaning = predicted && status === "blocked" ? PREDICTED_BLOCKED : MEANING[status];
  return (
    <Tooltip content={meaning} id={tooltipId}>
      <span
        className={`inline-flex items-center rounded-sm px-8 py-4 font-heading text-label font-medium uppercase leading-rg tracking-wide ${STYLE[status]}`}
      >
        {status}
      </span>
    </Tooltip>
  );
}
