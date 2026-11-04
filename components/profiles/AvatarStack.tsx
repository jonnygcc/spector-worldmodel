import { User, X } from "lucide-react";
import { visibleProfiles, type Profile } from "./profiles";

// size-control (26.1px) matches the row's other pills so the row doesn't grow when avatars appear.
// NO TOKEN: the remove x's 2px padding and its 2px offset.
const AVATAR =
  "relative flex size-control shrink-0 cursor-pointer items-center justify-center rounded-full border bg-neutral-100 text-neutral-800";

// If the profile being edited would be hidden, it takes the last slot so it stays visible.
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
