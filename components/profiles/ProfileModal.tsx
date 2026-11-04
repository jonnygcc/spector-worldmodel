"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import AddProfileButton from "./AddProfileButton";
import AvatarStack from "./AvatarStack";
import {
  MAX_PROFILES,
  PROFILE_PLACEHOLDER,
  VISIBLE_IN_MODAL,
  nextHiddenProfile,
  type Profile,
} from "./profiles";

// Native <dialog>: traps focus, closes on Escape and draws the scrim. Closing discards changes.
// NO TOKEN: the card width, 448px.
export default function ProfileModal({
  open,
  draft,
  editingId,
  onEdit,
  onAdd,
  onRemove,
  onChange,
  onSave,
  onClose,
}: {
  open: boolean;
  draft: Profile[];
  editingId: number | null;
  onEdit: (id: number) => void;
  onAdd: () => void;
  onRemove: (id: number) => void;
  onChange: (description: string) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editing = draft.find((p) => p.id === editingId);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      textareaRef.current?.focus();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (open) textareaRef.current?.focus();
  }, [editingId, open]);

  function showNextHidden() {
    const next = nextHiddenProfile(draft, VISIBLE_IN_MODAL, editingId);
    if (next) onEdit(next.id);
  }

  return (
    <dialog
      ref={dialogRef}
      aria-label="Profiles"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose();
      }}
      className="m-auto w-[448px] max-w-full overflow-visible bg-transparent p-0 backdrop:bg-neutral-700/50"
    >
      <div className="flex flex-col gap-8 rounded-md border border-neutral-300 bg-neutral-100 p-12">
        <div className="flex items-center">
          <div className="flex flex-1 items-center gap-8">
            <AddProfileButton onClick={onAdd} disabled={draft.length >= MAX_PROFILES} />
            <AvatarStack
              profiles={draft}
              count={VISIBLE_IN_MODAL}
              editingId={editingId}
              onSelect={onEdit}
              onRemove={onRemove}
              onMore={showNextHidden}
            />
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="flex shrink-0 cursor-pointer items-center justify-center text-neutral-800"
          >
            <X aria-hidden="true" className="size-16" />
          </button>
        </div>

        <textarea
          ref={textareaRef}
          aria-label="Profile description"
          placeholder={PROFILE_PLACEHOLDER}
          value={editing?.description ?? ""}
          disabled={!editing}
          onChange={(e) => onChange(e.target.value)}
          className="w-full resize-none rounded-md border border-neutral-300 bg-neutral-100 px-12 pb-64 pt-12 font-body text-body font-regular leading-lg tracking-tight text-neutral-800 transition-colors duration-150 placeholder:text-neutral-400 focus:border-accent disabled:cursor-not-allowed"
        />

        <button
          type="button"
          onClick={onSave}
          // mt-8 plus the card's gap-8 = 16px between the textarea and Save.
          className="mt-8 w-full cursor-pointer rounded-full bg-accent p-8 font-body text-body font-medium leading-rg tracking-tight text-neutral-100 transition-colors duration-150 hover:bg-accent-hover"
        >
          Save
        </button>
      </div>
    </dialog>
  );
}
