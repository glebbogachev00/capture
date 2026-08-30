import { markUndone, mergeCorrections, mergeLedgers } from "./ledger";
import { mergeCompletions, mergeWraps } from "./wrap";
import type { Board } from "./model";

/**
 * Restoring the board after an undo — the most bug-prone lines this app
 * has ever had, now in one place with behavior tests instead of incident
 * reports.
 *
 * Undo reverts ONE capture on a board that kept living: the push reply at
 * 1.2s and every poll merge the hub in, so by the time Undo is pressed the
 * board may hold another device's work. The restore therefore cannot be
 * "put the snapshot back" — that is how a single Undo once destroyed every
 * wrap and tick receipt on the device (the field-by-field rebuild dropped
 * what it did not name), and how it would delete a capture made elsewhere.
 *
 * The rules, each learned the hard way:
 *
 *   - Only what THIS capture created goes (snap.addedIds). Items the
 *     snapshot lacks that the capture did not create are FOREIGN — another
 *     device's — and survive.
 *   - What the capture REMOVED comes back bumped to now, so it out-ages
 *     the tombstone the capture itself pushed for it.
 *   - What both sides hold keeps the snapshot's version, unbumped.
 *   - History is append-only: the other device's entries stay, and only
 *     this capture's own entries are marked undone — marked, never
 *     deleted, because the record is what was said.
 *   - Wraps, completions, and the history epoch are none of this
 *     capture's business and merge through, never rebuild.
 */

export type UndoSnapshot = {
  board: Board;
  /** Ids of everything the capture created, across all lists. */
  addedIds?: Set<string>;
  /** The ledger entries the capture wrote. */
  ledgerIds?: string[];
};

export function restoreCapture(
  live: Board,
  snap: UndoSnapshot,
  now: number
): Board {
  const bump = <T extends { updatedAt?: number }>(x: T): T => ({
    ...x,
    updatedAt: now,
  });
  const had = (list: { id: string }[], id: string) =>
    list.some((x) => x.id === id);
  const mine = snap.addedIds ?? new Set<string>();
  const foreign = <T extends { id: string }>(a: T[], snapped: T[]) =>
    a.filter((x) => !mine.has(x.id) && !had(snapped, x.id));

  return {
    actions: [
      ...foreign(live.actions, snap.board.actions),
      ...snap.board.actions.map((a) => (had(live.actions, a.id) ? a : bump(a))),
    ],
    threads: [
      ...foreign(live.threads, snap.board.threads),
      ...snap.board.threads.map((t) => {
        const alive = live.threads.find((x) => x.id === t.id);
        if (!alive) return { ...bump(t), frags: t.frags.map(bump) };
        return {
          ...t,
          frags: [
            ...t.frags.map((f) => (had(alive.frags, f.id) ? f : bump(f))),
            ...foreign(alive.frags, t.frags),
          ],
        };
      }),
    ],
    intentions: [
      ...foreign(live.intentions, snap.board.intentions),
      ...snap.board.intentions.map((i) =>
        had(live.intentions, i.id) ? i : bump(i)
      ),
    ],
    principles: [
      ...snap.board.principles.map((p) =>
        had(live.principles, p.id) ? p : bump(p)
      ),
      ...foreign(live.principles, snap.board.principles),
    ],
    ledger: mergeLedgers(
      snap.board.ledger ?? [],
      markUndone(live.ledger ?? [], snap.ledgerIds ?? [])
    ),
    corrections: mergeCorrections(
      snap.board.corrections ?? [],
      live.corrections ?? []
    ),
    wraps: mergeWraps(snap.board.wraps ?? [], live.wraps ?? []),
    completions: mergeCompletions(
      snap.board.completions ?? [],
      live.completions ?? []
    ),
    historyEpoch: Math.max(
      snap.board.historyEpoch ?? 0,
      live.historyEpoch ?? 0
    ),
  };
}
