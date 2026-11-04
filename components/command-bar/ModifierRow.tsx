"use client";

import { useEffect, useRef, useState } from "react";
import AddProfileButton from "@/components/profiles/AddProfileButton";
import AvatarStack from "@/components/profiles/AvatarStack";
import ProfileModal from "@/components/profiles/ProfileModal";
import { MAX_PROFILES, VISIBLE_IN_BAR, type Profile } from "@/components/profiles/profiles";
import ModelPicker from "./ModelPicker";
import ModeSwitch, { type Mode } from "./ModeSwitch";

// Profiles are local state, not persisted. The modal edits a draft: Save applies it
// (dropping empty profiles), closing discards it.
export default function ModifierRow({
  onPersonaChange,
}: {
  // Personal mode needs at least one written profile before the bar can submit.
  onPersonaChange?: (ready: boolean) => void;
}) {
  const [mode, setMode] = useState<Mode>("automatic");
  const [profiles, setProfiles] = useState<Profile[]>([]);

  useEffect(() => {
    onPersonaChange?.(mode === "automatic" || profiles.length > 0);
  }, [mode, profiles, onPersonaChange]);
  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState<Profile[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const nextId = useRef(1);

  function newProfile(): Profile {
    return { id: nextId.current++, description: "" };
  }

  // From "+ Add profile" it creates a new profile (or edits the first one once there are six).
  function openModal(target: "new" | number) {
    let next = [...profiles];
    let editing: number | null;
    if (target === "new") {
      if (next.length < MAX_PROFILES) {
        const created = newProfile();
        next = [...next, created];
        editing = created.id;
      } else {
        editing = next[0].id;
      }
    } else {
      editing = target;
    }
    setDraft(next);
    setEditingId(editing);
    setModalOpen(true);
  }

  function addInModal() {
    if (draft.length >= MAX_PROFILES) return;
    const created = newProfile();
    setDraft([...draft, created]);
    setEditingId(created.id);
  }

  function removeInModal(id: number) {
    const index = draft.findIndex((p) => p.id === id);
    const rest = draft.filter((p) => p.id !== id);
    setDraft(rest);
    setEditingId(rest[Math.min(index, rest.length - 1)]?.id ?? null);
  }

  function changeInModal(description: string) {
    setDraft(draft.map((p) => (p.id === editingId ? { ...p, description } : p)));
  }

  function save() {
    setProfiles(draft.filter((p) => p.description.trim() !== ""));
    setModalOpen(false);
  }

  return (
    // Mobile: one row per control. From lg, a single line with the model on the right.
    <div className="flex flex-col items-start gap-8 px-12 lg:flex-row lg:flex-wrap lg:items-center">
      <ModeSwitch value={mode} onChange={setMode} />

      {mode === "personal" && (
        <div className="flex items-center gap-8">
          <AddProfileButton
            onClick={() => openModal("new")}
            disabled={profiles.length >= MAX_PROFILES}
          />
          <AvatarStack
            profiles={profiles}
            count={VISIBLE_IN_BAR}
            onSelect={(id) => openModal(id)}
            onMore={() => openModal(profiles[VISIBLE_IN_BAR].id)}
          />
        </div>
      )}

      <div className="hidden flex-1 lg:block" />
      <ModelPicker />

      {/* Profiles only count in Personal mode. */}
      <input type="hidden" name="mode" value={mode} />
      {mode === "personal" &&
        profiles.map((p) => <input key={p.id} type="hidden" name="profile" value={p.description} />)}

      <ProfileModal
        open={modalOpen}
        draft={draft}
        editingId={editingId}
        onEdit={setEditingId}
        onAdd={addInModal}
        onRemove={removeInModal}
        onChange={changeInModal}
        onSave={save}
        onClose={() => setModalOpen(false)}
      />
    </div>
  );
}
