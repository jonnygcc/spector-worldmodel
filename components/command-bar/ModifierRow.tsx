"use client";

import { useEffect, useRef, useState } from "react";
import AddProfileButton from "@/components/profiles/AddProfileButton";
import AvatarStack from "@/components/profiles/AvatarStack";
import ProfileModal from "@/components/profiles/ProfileModal";
import { MAX_PROFILES, VISIBLE_IN_BAR, type Profile } from "@/components/profiles/profiles";
import ModelPicker from "./ModelPicker";
import ModeSwitch, { type Mode } from "./ModeSwitch";

// Fila superior de la barra: modo, perfiles y modelo. En Personal aparecen
// "+ Add profile" y los avatares a la derecha del switch; en Automatic no.
//
// Los perfiles son estado local, sin persistencia. El modal trabaja sobre
// una copia (draft): "Save" la aplica quitando los perfiles vacíos;
// cerrar con la X, Escape o click fuera la descarta.
export default function ModifierRow({
  onPersonaChange,
}: {
  // Avisa a la barra si el modo y los perfiles permiten enviar: en
  // Personal hace falta al menos un perfil escrito.
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

  // Abre el modal. Desde "+ Add profile" crea un perfil nuevo y lo edita
  // (si ya hay seis, edita el primero); desde un avatar edita ese perfil.
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
    // Móvil (Phone/Home): una fila por control, apilados a la izquierda.
    // Desde lg, todos en una línea con el modelo a la derecha.
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

      {/* Lo que viaja con el formulario al enviar. Los perfiles solo
          cuentan en Personal. */}
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
