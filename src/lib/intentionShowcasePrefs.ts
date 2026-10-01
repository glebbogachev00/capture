import type { Board, ProfileDraft, ProfileUpdate } from "./model";

/** Evaluate in the durable transaction, not against the render that queued it. */
export function applyProfileUpdate(board: Board, update: ProfileUpdate): Board {
  const current = { ...board.profile, name: board.profile?.name ?? "" };
  delete current.updatedAt;
  const next = typeof update === "function" ? update(current) : update;
  return { ...board, profile: { ...board.profile, ...next } };
}

/** Toggle one exact id; never couple the saved selection to showcase visibility. */
export function toggleIntentionPin(current: ProfileDraft, id: string): ProfileDraft {
  const pins = [...new Set(current.pinnedIntentionIds ?? [])];
  return {
    ...current,
    pinnedIntentionIds: pins.includes(id)
      ? pins.filter((pinned) => pinned !== id)
      : [...pins, id],
  };
}
