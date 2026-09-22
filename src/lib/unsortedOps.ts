import type { CaptureEntry } from "./ledger";
import type { Action, Board } from "./model";

/** Treat both the current pending kind and every pre-migration relationship as
    unclassified. Consumers use this at their own boundary in addition to the
    hydrate migration, so a raw backup/test board cannot disclose legacy rows. */
export function isPendingLedgerEntry(board: Board, entry: CaptureEntry): boolean {
  if (entry.kind === "pending") return true;
  if (board.actions.some((action) => action.unsorted && action.id === entry.targetId)) {
    return true;
  }
  return board.threads.some((thread) => (thread.frags ?? []).some((frag) =>
    frag.unsorted && entry.targetId === thread.id && entry.targetFragId === frag.id
  ));
}

export function settledLedgerEntries(board: Board): CaptureEntry[] {
  return (board.ledger ?? []).filter((entry) => !isPendingLedgerEntry(board, entry));
}

/** Local-only edits for a capture that has not been classified yet. */
export function editUnsortedCapture(
  board: Board,
  id: string,
  text: string
): Board | null {
  const clean = text.trim();
  if (!clean) return null;
  const target = board.actions.find((action) => action.id === id && action.unsorted);
  if (!target || (target.text === clean && target.src === clean)) return null;
  return {
    ...board,
    actions: board.actions.map((action) =>
      action.id === id ? { ...action, text: clean, src: clean } : action
    ),
    ledger: board.ledger.map((entry) =>
      entry.kind === "pending" && entry.targetId === id
        ? { ...entry, raw: clean, clean }
        : entry
    ),
  };
}

/** Remove a waiting envelope and retire its pending record atomically. */
export function removeUnsortedCapture(board: Board, action: Action): Board | null {
  if (!board.actions.some((item) => item.id === action.id && item.unsorted)) return null;
  return {
    ...board,
    actions: board.actions.filter((item) => item.id !== action.id),
    ledger: board.ledger.map((entry) =>
      entry.kind === "pending" && entry.targetId === action.id
        ? { ...entry, undone: true, imgs: undefined }
        : entry
    ),
  };
}
