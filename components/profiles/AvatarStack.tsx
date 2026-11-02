import { User, X } from "lucide-react";
import { visibleProfiles, type Profile } from "./profiles";

// El avatar y el contador miden size-control (26.1px), el mismo alto que
// "Add profile" y el resto de pastillas de la fila, para que la fila no
// crezca al aparecer. Dentro del borde quedan 24.1px: el icono de 16 deja
// 4px por lado y queda centrado.
//
// SIN TOKEN: el padding de 2px de la x de eliminar, y su desplazamiento
// de 2px (translate 1/8 de su tamaño) además de spacing-4.
const AVATAR =
  "relative flex size-control shrink-0 cursor-pointer items-center justify-center rounded-full border bg-neutral-100 text-neutral-800";

// Avatares de los perfiles, separados por spacing-4. Se ven `count` y el
// resto se agrupa en un contador "+N" del mismo tamaño y borde. Si el
// perfil que se está editando queda fuera, ocupa el último hueco para que
// siempre se vea; solo ese lleva la x de eliminar.
export default function AvatarStack({
  profiles,
  count,
  editingId,
  onSelect,
  onRemove,
  onMore,
}: {
  profiles: Profile[];
  count: number;
  editingId?: number | null;
  onSelect: (id: number) => void;
  onRemove?: (id: number) => void;
  onMore: () => void;
}) {
  if (profiles.length === 0) return null;

  const visible = visibleProfiles(profiles, count, editingId);
  const hidden = profiles.length - visible.length;

  return (
    <ul className="flex items-center gap-4">
      {visible.map((profile) => {
        const isEditing = profile.id === editingId;
        const n = profiles.indexOf(profile) + 1;

        return (
          <li key={profile.id} className={`relative ${isEditing ? "z-10" : ""}`}>
            <button
              type="button"
              aria-label={`Edit profile ${n}`}
              aria-pressed={editingId === undefined ? undefined : isEditing}
              onClick={() => onSelect(profile.id)}
              className={`${AVATAR} transition-colors duration-150 ${
                isEditing ? "border-neutral-800" : "border-neutral-300 hover:border-neutral-800"
              }`}
            >
              <span className="flex size-full items-center justify-center">
                <User aria-hidden="true" className="block size-16 shrink-0" />
              </span>
            </button>
            {isEditing && onRemove && (
              <button
                type="button"
                aria-label={`Remove profile ${n}`}
                onClick={() => onRemove(profile.id)}
                className="absolute -right-4 -top-4 flex translate-x-1/8 -translate-y-1/8 size-16 cursor-pointer items-center justify-center rounded-full bg-neutral-800 p-[2px] text-neutral-100 transition-colors duration-150 hover:bg-neutral-700"
              >
                <X aria-hidden="true" className="block size-full" />
              </button>
            )}
          </li>
        );
      })}
      {hidden > 0 && (
        <li className="relative">
          <button
            type="button"
            aria-label={`${hidden} more profiles`}
            onClick={onMore}
            className={`${AVATAR} border-neutral-300 font-body text-label font-regular leading-sm tracking-tight tabular-nums text-neutral-700 transition-colors duration-150 hover:border-neutral-800`}
          >
            +{hidden}
          </button>
        </li>
      )}
    </ul>
  );
}
