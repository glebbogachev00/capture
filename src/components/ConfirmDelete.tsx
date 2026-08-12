"use client";

import { createPortal } from "react-dom";

/**
 * The one confirm gate in front of every delete.
 *
 * A modal rather than an inline shelf: the ask floats over the page instead
 * of appearing at the bottom of the item, so it cannot be missed, cannot
 * shift the layout under your finger, and a tap outside is a "keep it".
 * Same skin as Organize's approve-all gate, so every irreversible step in
 * the app asks the same way.
 *
 * Portalled to <body>: the card that asks may sit inside an animated
 * (transformed) ancestor, which would silently turn `position: fixed` into
 * "fixed to the card" and leave half the page undimmed.
 */
export function ConfirmDelete({
  title,
  hint = "This cannot be undone.",
  confirmLabel = "Delete for good",
  onConfirm,
  onCancel,
}: {
  title: string;
  hint?: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return createPortal(
    <div className="modal" onClick={onCancel}>
      <div className="modal-in" onClick={(e) => e.stopPropagation()}>
        <p className="discard-title">{title}</p>
        <p className="discard-hint">{hint}</p>
        <div className="tools">
          <button className="ghost warn" onClick={onConfirm}>
            {confirmLabel}
          </button>
          <button className="ghost" onClick={onCancel}>
            Keep it
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
