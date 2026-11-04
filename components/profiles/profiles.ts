export type Profile = { id: number; description: string };

// Avatars shown before grouping into "+N": two in the bar, three in the modal (as in Paper).
export const MAX_PROFILES = 6;
export const VISIBLE_IN_BAR = 2;
export const VISIBLE_IN_MODAL = 3;

// If the profile being edited would be hidden, it takes the last slot.
export function visibleProfiles(profiles: Profile[], count: number, editingId?: number | null) {
  const visible = profiles.slice(0, count);
  const editing = profiles.find((p) => p.id === editingId);
  if (editing && !visible.includes(editing)) {
    return [...visible.slice(0, count - 1), editing];
  }
  return visible;
}

// "+N" in the modal jumps to the next hidden profile, wrapping around.
export function nextHiddenProfile(profiles: Profile[], count: number, editingId: number | null) {
  const visible = visibleProfiles(profiles, count, editingId);
  const start = profiles.findIndex((p) => p.id === editingId);
  for (let step = 1; step <= profiles.length; step++) {
    const candidate = profiles[(start + step) % profiles.length];
    if (!visible.includes(candidate)) return candidate;
  }
  return undefined;
}

export const PROFILE_PLACEHOLDER =
  "A 55 year old restaurant owner, not comfortable with technology, browsing on an old phone…";
