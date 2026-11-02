export type Profile = { id: number; description: string };

// Máximo de perfiles por análisis, y cuántos avatares se ven antes de
// agruparse en "+N": dos en la barra, tres en el modal (como en Paper).
export const MAX_PROFILES = 6;
export const VISIBLE_IN_BAR = 2;
export const VISIBLE_IN_MODAL = 3;

// Los avatares que se ven: los `count` primeros, salvo que el que se está
// editando quede fuera; entonces ocupa el último hueco.
export function visibleProfiles(profiles: Profile[], count: number, editingId?: number | null) {
  const visible = profiles.slice(0, count);
  const editing = profiles.find((p) => p.id === editingId);
  if (editing && !visible.includes(editing)) {
    return [...visible.slice(0, count - 1), editing];
  }
  return visible;
}

// "+N" dentro del modal: pasa al siguiente perfil oculto, en orden y
// volviendo al principio.
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
