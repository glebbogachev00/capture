import { z } from "zod";
import type { CaptureSource } from "./ledger";
import type { Board } from "./model";

export const PENDING_RECOVERY_KEY = "capture:pending-recovery:v1";
export const MAX_AUTOMATIC_PENDING_ATTEMPTS = 2;
export const MAX_RECOVERIES_PER_WAKE = 3;
export const PENDING_RECOVERY_BACKOFF_MS = 30_000;

export type PendingRecoverySnapshot = {
  pendingId: string;
  captureId: string;
  targetId: string;
  revision: number;
  source: string;
  force?: "action" | "thread" | "intention";
  inputSource: CaptureSource;
  imageIds: string[];
  at: number;
};

export type PendingRecoveryRecord = PendingRecoverySnapshot & {
  id: string;
  automaticAttempts: number;
  nextAttemptAt: number;
};

const text = z.string().min(1);
const RecordSchema = z.object({
  id: text,
  pendingId: text,
  captureId: text,
  targetId: text,
  revision: z.number().int().min(1),
  source: z.string(),
  force: z.enum(["action", "thread", "intention"]).optional(),
  inputSource: z.enum(["typed", "dictated", "distill", "image", "import"]),
  imageIds: z.array(text).max(4),
  at: z.number().finite(),
  automaticAttempts: z.number().int().min(0).max(MAX_AUTOMATIC_PENDING_ATTEMPTS),
  nextAttemptAt: z.number().finite(),
}).strict();

const enc = (value: string) => value.replace(/[^A-Za-z0-9.-]/g, (char) =>
  `~${char.charCodeAt(0).toString(16).padStart(4, "0")}~`
);

const sameIds = (left: string[] | undefined, right: readonly string[]) =>
  (left ?? []).length === right.length &&
  (left ?? []).every((id, index) => id === right[index]);

export function pendingRecoveryId(snapshot: PendingRecoverySnapshot): string {
  return `pending-recovery:${enc(snapshot.captureId)}:${enc(snapshot.pendingId)}:r${snapshot.revision}`;
}

/** Resolve one currently active pending card to the complete immutable identity
 * that a delayed or restarted request must continue to match. */
export function exactPendingSnapshot(
  board: Board,
  targetId: string,
): PendingRecoverySnapshot | null {
  const rows = board.ledger.filter((entry) =>
    entry.kind === "pending" && !entry.undone && entry.targetId === targetId
  );
  if (rows.length !== 1) return null;
  const row = rows[0];
  const action = board.actions.find((candidate) =>
    candidate.id === targetId && candidate.unsorted
  );
  if (!action) return null;
  const revision = action.pendingRevision ?? 1;
  const source = action.src ?? action.text;
  if (
    (row.pendingRevision ?? 1) !== revision ||
    (row.pendingSource ?? row.clean) !== source ||
    !sameIds(row.imgs, action.imgs ?? [])
  ) return null;
  return {
    pendingId: row.id,
    captureId: row.captureId ?? row.id,
    targetId,
    revision,
    source,
    ...(action.pendingForce ? { force: action.pendingForce } : {}),
    inputSource: row.source,
    imageIds: [...(action.imgs ?? [])],
    at: action.at,
  };
}

export function createPendingRecoveryRecord(
  snapshot: PendingRecoverySnapshot,
  automaticAttempts: number,
  nextAttemptAt: number,
): PendingRecoveryRecord {
  return RecordSchema.parse({
    ...snapshot,
    id: pendingRecoveryId(snapshot),
    automaticAttempts,
    nextAttemptAt,
  });
}

export function parsePendingRecoveryRecords(raw: string | null): PendingRecoveryRecord[] {
  if (!raw) return [];
  try {
    const parsed = z.array(RecordSchema).safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

export function serializePendingRecoveryRecords(records: PendingRecoveryRecord[]): string {
  return JSON.stringify(records);
}

export function recordMatchesPending(
  record: PendingRecoveryRecord,
  board: Board,
): boolean {
  const snapshot = exactPendingSnapshot(board, record.targetId);
  return !!snapshot &&
    pendingRecoveryId(snapshot) === record.id &&
    snapshot.pendingId === record.pendingId &&
    snapshot.captureId === record.captureId &&
    snapshot.revision === record.revision &&
    snapshot.source === record.source &&
    snapshot.force === record.force &&
    snapshot.inputSource === record.inputSource &&
    sameIds(snapshot.imageIds, record.imageIds);
}

export function snapshotMatchesPending(
  expected: PendingRecoverySnapshot,
  board: Board,
): boolean {
  const current = exactPendingSnapshot(board, expected.targetId);
  return !!current &&
    current.pendingId === expected.pendingId &&
    current.captureId === expected.captureId &&
    current.targetId === expected.targetId &&
    current.revision === expected.revision &&
    current.source === expected.source &&
    current.force === expected.force &&
    current.inputSource === expected.inputSource &&
    current.at === expected.at &&
    sameIds(current.imageIds, expected.imageIds);
}

export function prunePendingRecoveryRecords(
  records: PendingRecoveryRecord[],
  board: Board,
): PendingRecoveryRecord[] {
  return records.filter((record) => recordMatchesPending(record, board));
}

/** One wake observes a finite due snapshot. It never creates follow-up work. */
export function recoveryCandidates(
  records: PendingRecoveryRecord[],
  board: Board,
  now: number,
): PendingRecoveryRecord[] {
  /* Actions are newest first. Millisecond timestamps can tie when several
     offline captures are accepted in one turn, so board position is the
     durable insertion-order tiebreak rather than random ids. */
  const boardOrder = new Map(board.actions.map((action, index) => [action.id, index]));
  return prunePendingRecoveryRecords(records, board)
    .filter((record) =>
      record.automaticAttempts < MAX_AUTOMATIC_PENDING_ATTEMPTS &&
      record.nextAttemptAt <= now
    )
    .sort((left, right) =>
      left.at - right.at ||
      (boardOrder.get(right.targetId) ?? -1) - (boardOrder.get(left.targetId) ?? -1) ||
      left.id.localeCompare(right.id)
    )
    .slice(0, MAX_RECOVERIES_PER_WAKE);
}

/** Claim before network work. Persisting the returned list makes close/reload
 * consume the bounded attempt rather than replaying it forever. */
export function claimPendingRecovery(
  records: PendingRecoveryRecord[],
  board: Board,
  id: string,
  now: number,
): {
  records: PendingRecoveryRecord[];
  record: PendingRecoveryRecord;
  snapshot: PendingRecoverySnapshot;
} | null {
  const current = records.find((record) => record.id === id);
  if (
    !current ||
    current.automaticAttempts >= MAX_AUTOMATIC_PENDING_ATTEMPTS ||
    current.nextAttemptAt > now ||
    !recordMatchesPending(current, board)
  ) return null;
  const snapshot = exactPendingSnapshot(board, current.targetId);
  if (!snapshot) return null;
  const record = {
    ...current,
    automaticAttempts: current.automaticAttempts + 1,
    nextAttemptAt: now + PENDING_RECOVERY_BACKOFF_MS,
  };
  return {
    records: records.map((candidate) => candidate.id === id ? record : candidate),
    record,
    snapshot,
  };
}
