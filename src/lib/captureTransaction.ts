import type { CaptureOrigin } from "./intentionOps";
import type { Board } from "./model";
import type { Tombstone } from "./sync";
import type { UndoSnapshot } from "./undoOps";

export type CaptureUndoSnapshot = UndoSnapshot & {
  tombstones: Tombstone[];
  text?: string;
  picIds?: string[];
  captureId?: string;
};

function boardIds(board: Board): Set<string> {
  const ids = new Set<string>();
  for (const action of board.actions) ids.add(action.id);
  for (const thread of board.threads) {
    ids.add(thread.id);
    for (const fragment of thread.frags) ids.add(fragment.id);
  }
  for (const intention of board.intentions) ids.add(intention.id);
  for (const principle of board.principles) ids.add(principle.id);
  return ids;
}

function restorableBoardIds(board: Board): Set<string> {
  const ids = boardIds(board);
  for (const action of board.actions) if (action.unsorted) ids.delete(action.id);
  return ids;
}

/** The exact inverse ownership recorded when an undoable transition lands. */
export function captureUndoDelta(before: Board, after: Board) {
  const beforeIds = boardIds(before);
  const afterIds = boardIds(after);
  const restorableBefore = restorableBoardIds(before);
  const beforeFragHome = new Map(
    before.threads.flatMap((thread) => thread.frags.map((frag) => [frag.id, thread.id] as const)),
  );
  const afterFragHome = new Map(
    after.threads.flatMap((thread) => thread.frags.map((frag) => [frag.id, thread.id] as const)),
  );
  return {
    addedIds: new Set([...afterIds].filter((id) => !beforeIds.has(id))),
    removedIds: new Set([...restorableBefore].filter((id) => !afterIds.has(id))),
    movedFragIds: new Set([...beforeFragHome].flatMap(([id, home]) =>
      afterFragHome.has(id) && afterFragHome.get(id) !== home ? [id] : []
    )),
    landedBoard: after,
  };
}

export function captureOwnedTombstones(
  before: Tombstone[],
  after: Tombstone[],
  removedIds: Set<string>,
): Tombstone[] {
  const prior = new Map(before.map((tombstone) => [
    `${tombstone.kind}:${tombstone.id}`,
    tombstone.deletedAt,
  ]));
  return after.filter((tombstone) =>
    removedIds.has(tombstone.id) &&
    prior.get(`${tombstone.kind}:${tombstone.id}`) !== tombstone.deletedAt
  );
}

/** The ids `after` has that `before` does not — what one capture created. */
export function newCaptureIds(before: Board, after: Board): Set<string> {
  const had = boardIds(before);
  return new Set([...boardIds(after)].filter((id) => !had.has(id)));
}

/** Every ledger row written by one Board transition. */
export function newCaptureLedgerIds(before: Board, after: Board): string[] {
  const had = new Set((before.ledger ?? []).map((entry) => entry.id));
  return (after.ledger ?? []).filter((entry) => !had.has(entry.id)).map((entry) => entry.id);
}

export function captureUndoSnapshot(
  before: Board,
  beforeTombstones: Tombstone[],
  after: Board,
  afterTombstones: Tombstone[],
  extra: Pick<CaptureUndoSnapshot, "text" | "picIds" | "captureId"> = {},
  includeLedger = true,
): CaptureUndoSnapshot {
  const delta = captureUndoDelta(before, after);
  return {
    board: before,
    tombstones: beforeTombstones,
    ...extra,
    ...delta,
    ...(includeLedger ? { ledgerIds: newCaptureLedgerIds(before, after) } : {}),
    ownedTombstones: captureOwnedTombstones(
      beforeTombstones,
      afterTombstones,
      delta.removedIds,
    ),
  };
}

/** Attach a pending draft's evidence only to entries created by this landing. */
export function preserveDraftOrigin(
  before: Board,
  after: Board,
  origin?: CaptureOrigin | null,
): Board {
  if (!origin) return after;
  const fresh = new Set(newCaptureLedgerIds(before, after));
  return {
    ...after,
    ledger: after.ledger.map((entry) => fresh.has(entry.id)
      ? { ...entry, raw: origin.raw, source: origin.source, transcript: origin.transcript }
      : entry),
  };
}
