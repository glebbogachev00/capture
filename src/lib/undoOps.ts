import { markUndone, mergeCorrections, mergeLedgers, type CaptureEntry } from "./ledger";
import { mergeCompletions, mergeWraps } from "./wrap";
import type { Board } from "./model";
import { mergeTombstones, type Tombstone } from "./sync";

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
 *   - Same-id fields revert only if the owned landing changed them and their
 *     current value still equals that landing. Newer conflicting edits stay.
 *   - History is append-only: the other device's entries stay, and only
 *     this capture's own entries are marked undone — marked, never
 *     deleted, because the record is what was said.
 *   - Wraps, completions, the profile, and the history epoch are none of this
 *     capture's business and merge through, never rebuild.
 */

export type UndoSnapshot = {
  board: Board;
  /** Ids of everything the capture created, across all lists. */
  addedIds?: Set<string>;
  /** Pre-existing artifacts this exact transition removed. Only these may be
   * restored; absence from the live board alone can be a later remote delete. */
  removedIds?: Set<string>;
  /** Pre-existing fragments this exact transition moved between Threads. */
  movedFragIds?: Set<string>;
  /** The board immediately after the owned transition. Together with board,
   * it records the inverse field values; no landing means no field ownership.
   * Moves reverse only while still where that transition put the fragment. */
  landedBoard?: Board;
  /** Tombstones written by this transition for restorable removals. Exact
   * timestamps distinguish them from a later remote delete of the same id. */
  ownedTombstones?: Tombstone[];
  /** The ledger entries the capture wrote. */
  ledgerIds?: string[];
};

const tombstoneKey = (tombstone: Tombstone) => `${tombstone.kind}:${tombstone.id}`;

/** Preserve every current tombstone except the exact owned deletions Undo is
 * reversing. A newer same-id remote delete wins and remains durable. */
export function tombstonesAfterUndo(
  current: Tombstone[],
  owned: Tombstone[],
  generated: Tombstone[],
  now = Date.now(),
): Tombstone[] {
  const ownedByKey = new Map(owned.map((tombstone) => [tombstoneKey(tombstone), tombstone]));
  const preserved = current.filter((tombstone) => {
    const candidate = ownedByKey.get(tombstoneKey(tombstone));
    return !candidate || candidate.deletedAt !== tombstone.deletedAt;
  });
  return mergeTombstones(preserved, generated, now);
}

/** Aggregate all rows one capture settled before deciding whether Undo is a
 * learnable model rejection. Mixed Action+Thread is the capture-level `both`
 * outcome even when settlement stores one row per destination. */
export function captureUndoOutcome(entries: CaptureEntry[]): {
  kind: "action" | "thread" | "intention" | "both" | null;
  learningKind: "action" | "thread" | "intention" | null;
  representative: CaptureEntry | undefined;
} {
  const settled = entries.filter((entry) =>
    entry.kind !== "pending" && !entry.undone
  );
  if (!settled.length) {
    return { kind: null, learningKind: null, representative: undefined };
  }
  const kinds = new Set(settled.flatMap((entry) =>
    entry.kind === "both" ? ["action", "thread"] as const : [entry.kind]
  ));
  const kind = kinds.size === 1
    ? [...kinds][0] as "action" | "thread" | "intention"
    : "both";
  const learningKind = kind !== "both" &&
    !settled.some((entry) => entry.settledBy === "manual")
      ? kind
      : null;
  return { kind, learningKind, representative: settled[0] };
}

/** Only an automatic classification can be evidence that the model chose the
 * wrong shape. Manual filing is the person's authoritative choice, so taking
 * it back must not create a rejected-model correction or a learning prompt. */
export function undoLearningKind(
  entry: CaptureEntry | null | undefined,
): "action" | "thread" | "intention" | null {
  if (
    !entry ||
    entry.settledBy === "manual" ||
    entry.kind === "both" ||
    entry.kind === "pending"
  ) return null;
  return entry.kind;
}

/** Board fields are data values: sync/hydration can replace their references.
 * Own keys matter here; JSON.stringify would lose explicit undefined fields. */
function sameFieldValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b) && a.length !== b.length) return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) =>
    Object.prototype.hasOwnProperty.call(right, key) && sameFieldValue(left[key], right[key])
  );
}

function isFieldObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Reverse only fields owned by before → landed, and only while the live
 * value (including property presence) still matches that landing. Arrays are
 * atomic fields; nested objects retain independently edited sibling fields. */
function restoreOwnedFields<T extends object>(current: T, before: T, landed: T, skip: string[] = []): T {
  const out = { ...current };
  for (const key of new Set([...Object.keys(before), ...Object.keys(landed)]) as Set<keyof T>) {
    if (skip.includes(String(key))) continue;
    const had = Object.prototype.hasOwnProperty.call(before, key);
    const wrote = Object.prototype.hasOwnProperty.call(landed, key);
    const has = Object.prototype.hasOwnProperty.call(current, key);
    if (had === wrote && sameFieldValue(before[key], landed[key])) continue;
    const prior = before[key];
    const owned = landed[key];
    const live = current[key];
    if (had && wrote && has && isFieldObject(prior) && isFieldObject(owned) && isFieldObject(live)) {
      out[key] = restoreOwnedFields(live, prior, owned) as T[keyof T];
      continue;
    }
    if (has !== wrote || !sameFieldValue(live, owned)) continue;
    if (had) out[key] = before[key];
    else delete out[key];
  }
  return out;
}

export function restoreCapture(
  live: Board,
  snap: UndoSnapshot,
  now: number
): Board {
  const bump = <T extends { updatedAt?: number }>(x: T): T => ({
    ...x,
    updatedAt: now,
  });
  const mine = snap.addedIds ?? new Set<string>();
  const removed = snap.removedIds ?? new Set<string>();
  const movedFrags = snap.movedFragIds ?? new Set<string>();

  /** Undo is an inverse patch, not a snapshot restore. Same-id fields are
   * conditional on the owned landing; unrelated and newer edits survive.
   * Only an id explicitly removed by this transition may come back. */
  const restoreOwnedRemovals = <T extends { id: string; updatedAt?: number }>(
    current: T[],
    before: T[],
    landed: T[] = [],
    eligible: (item: T) => boolean = () => true,
  ): T[] => {
    const beforeById = new Map(before.map((item) => [item.id, item]));
    const landedById = new Map(landed.map((item) => [item.id, item]));
    const kept = current.filter((item) => !mine.has(item.id)).map((item) => {
      const prior = beforeById.get(item.id);
      const owned = landedById.get(item.id);
      return prior && owned ? restoreOwnedFields(item, prior, owned) : item;
    });
    const currentIds = new Set(current.map((item) => item.id));
    const revived = before
      .filter((item) => removed.has(item.id) && !currentIds.has(item.id) && eligible(item))
      .map(bump);
    return [...kept, ...revived];
  };

  const beforeFrags = new Map(snap.board.threads.flatMap((thread) =>
    thread.frags.map((frag) => [frag.id, frag] as const)
  ));
  const landedFrags = new Map((snap.landedBoard?.threads ?? []).flatMap((thread) =>
    thread.frags.map((frag) => [frag.id, frag] as const)
  ));
  const restoreFragFields = (frag: Board["threads"][number]["frags"][number]) => {
    const before = beforeFrags.get(frag.id);
    const landed = landedFrags.get(frag.id);
    return before && landed ? restoreOwnedFields(frag, before, landed) : frag;
  };
  const liveFragHome = new Map<string, { threadId: string; frag: Board["threads"][number]["frags"][number] }>();
  for (const thread of live.threads) {
    for (const frag of thread.frags) liveFragHome.set(frag.id, { threadId: thread.id, frag });
  }
  const landedFragHome = new Map<string, string>();
  for (const thread of snap.landedBoard?.threads ?? []) {
    for (const frag of thread.frags) landedFragHome.set(frag.id, thread.id);
  }
  const shouldReverseMove = (id: string) => {
    if (!movedFrags.has(id)) return false;
    const currentHome = liveFragHome.get(id)?.threadId;
    const ownedHome = landedFragHome.get(id);
    return !ownedHome || currentHome === ownedHome;
  };

  const liveThreads = live.threads.filter((thread) => !mine.has(thread.id));
  const threadIds = new Set(liveThreads.map((thread) => thread.id));
  const restoredThreads = snap.board.threads
    .filter((thread) => removed.has(thread.id) && !threadIds.has(thread.id))
    .map((thread) => ({
      ...bump(thread),
      frags: thread.frags
        .filter((frag) => !mine.has(frag.id) &&
          (!movedFrags.has(frag.id) || shouldReverseMove(frag.id)))
        .map(bump),
    }));
  const threads = [...liveThreads, ...restoredThreads].map((thread) => {
    const beforeThread = snap.board.threads.find((candidate) => candidate.id === thread.id);
    if (!beforeThread) {
      return { ...thread, frags: thread.frags.filter((frag) => !mine.has(frag.id)).map(restoreFragFields) };
    }
    const kept = thread.frags.filter((frag) =>
      !mine.has(frag.id) && !shouldReverseMove(frag.id)
    ).map(restoreFragFields);
    const keptIds = new Set(kept.map((frag) => frag.id));
    const restored = beforeThread.frags.flatMap((frag) => {
      if (mine.has(frag.id) || keptIds.has(frag.id)) return [];
      if (shouldReverseMove(frag.id)) return [restoreFragFields(liveFragHome.get(frag.id)?.frag ?? frag)];
      if (removed.has(frag.id) && !liveFragHome.has(frag.id)) return [bump(frag)];
      return [];
    });
    const landedThread = snap.landedBoard?.threads.find((candidate) => candidate.id === thread.id);
    const fields = landedThread
      ? restoreOwnedFields(thread, beforeThread, landedThread, ["frags"])
      : thread;
    return { ...fields, frags: [...restored, ...kept] };
  });

  return {
    ...snap.board,
    ...live,
    actions: restoreOwnedRemovals(
      live.actions,
      snap.board.actions,
      snap.landedBoard?.actions,
      (action) => !action.unsorted,
    ),
    threads,
    intentions: restoreOwnedRemovals(live.intentions, snap.board.intentions, snap.landedBoard?.intentions),
    principles: restoreOwnedRemovals(live.principles, snap.board.principles, snap.landedBoard?.principles),
    ledger: mergeLedgers(
      (snap.board.ledger ?? []).filter((entry) => entry.kind !== "pending"),
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
    profile: live.profile,
    historyEpoch: Math.max(
      snap.board.historyEpoch ?? 0,
      live.historyEpoch ?? 0
    ),
  };
}
