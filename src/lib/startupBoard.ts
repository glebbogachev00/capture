import { CORRUPT, EMPTY, KEY, hydrate, sweep, type Board } from "./model";
import {
  expiredDays,
  snapshotDay,
  snapshotDays,
  snapshotKey,
  worthSnapshotting,
} from "./snapshots";
import { del, get, keys, set, setMany } from "./storage";
import { TOMBSTONE_KEY, type SyncState, type Tombstone } from "./sync";
import { DurableBoardCommitQueue, prepareDurableBoardCommit } from "./durableBoardCommit";
import { parsePersistedBoard } from "./persistedBoard";

async function keepDailySnapshot(board: Board): Promise<void> {
  if (!worthSnapshotting(board)) return;
  try {
    const today = snapshotKey(snapshotDay(Date.now()));
    const existing = await keys();
    if (!existing.includes(today)) await set(today, JSON.stringify(board));
    for (const day of expiredDays(snapshotDays([...existing, today]))) {
      await del(snapshotKey(day));
    }
  } catch {
    /* Snapshot failure never blocks opening the authoritative board. */
  }
}

export type StartupBoard = SyncState & {
  faded: number;
  cleared: number;
  quarantined: boolean;
};

const TOMBSTONE_KINDS = new Set(["action", "thread", "frag", "intention", "principle"]);

function readTombstones(raw: string | null): Tombstone[] {
  if (raw === null) return [];
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value) || !value.every((entry): entry is Tombstone => {
    if (!entry || typeof entry !== "object") return false;
    const candidate = entry as Partial<Tombstone>;
    return typeof candidate.kind === "string" &&
      TOMBSTONE_KINDS.has(candidate.kind) &&
      typeof candidate.id === "string" &&
      candidate.id.length > 0 &&
      typeof candidate.deletedAt === "number" &&
      Number.isFinite(candidate.deletedAt);
  })) throw new Error("Unreadable tombstones");
  return value;
}

/** Load, sweep, persist Board+tombstones atomically, then return adoptable state. */
export async function loadStartupBoard(
  queue: DurableBoardCommitQueue,
  allowed: () => boolean,
): Promise<StartupBoard | null> {
  let board = EMPTY;
  let quarantined = false;
  const rawBoard = await get(KEY);
  if (rawBoard !== null) {
    try {
      const parsed: unknown = JSON.parse(rawBoard);
      const persisted = parsePersistedBoard(parsed);
      if (!persisted) throw new Error("Unreadable Board shape");
      board = hydrate(persisted);
    } catch {
      /* Replacement is safe only after the exact unreadable source has been
         durably parked. A failed quarantine leaves the live key untouched and
         aborts startup rather than turning a storage problem into data loss. */
      await set(CORRUPT, rawBoard);
      quarantined = true;
    }
  }
  /* Absence is the only first-run signal. Read, parse, or shape failures keep
     both authoritative keys byte-for-byte intact and block sync adoption. */
  const tombstones = readTombstones(await get(TOMBSTONE_KEY));

  void keepDailySnapshot(board);
  const { next, faded, cleared } = await sweep(board);
  return queue.run(async () => {
    if (!allowed()) return null;
    const prepared = prepareDurableBoardCommit(board, next, tombstones);
    await setMany([
      [KEY, JSON.stringify(prepared.board)],
      [TOMBSTONE_KEY, JSON.stringify(prepared.tombstones)],
    ]);
    return allowed() ? { ...prepared, faded, cleared, quarantined } : null;
  });
}
