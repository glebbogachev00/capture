import { describe, expect, it } from "vitest";
import { EMPTY, type Board } from "./model";
import {
  MAX_AUTOMATIC_PENDING_ATTEMPTS,
  MAX_RECOVERIES_PER_WAKE,
  PENDING_RECOVERY_BACKOFF_MS,
  claimPendingRecovery,
  createPendingRecoveryRecord,
  exactPendingSnapshot,
  parsePendingRecoveryRecords,
  prunePendingRecoveryRecords,
  recoveryCandidates,
  serializePendingRecoveryRecords,
  snapshotMatchesPending,
  type PendingRecoveryRecord,
} from "./pendingRecovery";

const pending = (overrides: Partial<Board> = {}): Board => ({
  ...EMPTY,
  principles: [],
  actions: [{
    id: "pending-target",
    text: "Exact pending source",
    src: "Exact pending source",
    imgs: ["image-one", "image-two"],
    done: false,
    at: 100,
    updatedAt: 100,
    shelf: "keep",
    expires: null,
    unsorted: true,
    pendingRevision: 2,
  }],
  ledger: [{
    id: "pending-row",
    captureId: "capture-one",
    at: 100,
    raw: "Raw provenance",
    clean: "Exact pending source",
    pendingSource: "Exact pending source",
    kind: "pending",
    pendingRevision: 2,
    source: "dictated",
    targetId: "pending-target",
    imgs: ["image-one", "image-two"],
  }],
  ...overrides,
});

function record(board = pending(), attempts = 0, nextAttemptAt = 100): PendingRecoveryRecord {
  const snapshot = exactPendingSnapshot(board, "pending-target")!;
  return createPendingRecoveryRecord(snapshot, attempts, nextAttemptAt);
}

describe("durable pending recovery policy", () => {
  it.each(["action", "thread", "intention"] as const)(
    "persists and matches explicit %s authority across recovery reloads",
    (force) => {
      const board = pending();
      board.actions[0] = { ...board.actions[0], pendingForce: force };
      const snapshot = exactPendingSnapshot(board, "pending-target")!;
      expect(snapshot).toMatchObject({ force });
      const saved = createPendingRecoveryRecord(snapshot, 0, 100);
      const reloaded = parsePendingRecoveryRecords(serializePendingRecoveryRecords([saved]));
      expect(reloaded).toEqual([expect.objectContaining({ force })]);
      expect(claimPendingRecovery(reloaded, board, saved.id, 100)?.snapshot).toMatchObject({ force });
      const changed = { ...board, actions: [{ ...board.actions[0], pendingForce: undefined }] };
      expect(snapshotMatchesPending(snapshot, changed)).toBe(false);
      expect(prunePendingRecoveryRecords(reloaded, changed)).toEqual([]);
      expect(snapshotMatchesPending(exactPendingSnapshot(pending(), "pending-target")!, pending())).toBe(true);
    },
  );


  it("binds recovery to the exact pending row, capture, revision, source and ordered images", () => {
    const snapshot = exactPendingSnapshot(pending(), "pending-target");
    expect(snapshot).toEqual({
      pendingId: "pending-row",
      captureId: "capture-one",
      targetId: "pending-target",
      revision: 2,
      source: "Exact pending source",
      inputSource: "dictated",
      imageIds: ["image-one", "image-two"],
      at: 100,
    });

    expect(exactPendingSnapshot(pending({
      actions: [{ ...pending().actions[0], imgs: ["image-two", "image-one"] }],
    }), "pending-target")).toBeNull();
    expect(exactPendingSnapshot(pending({
      ledger: [{ ...pending().ledger[0], pendingSource: "Changed source" }],
    }), "pending-target")).toBeNull();
    expect(exactPendingSnapshot(pending({
      ledger: [pending().ledger[0], { ...pending().ledger[0], id: "duplicate-row" }],
    }), "pending-target")).toBeNull();
  });

  it("round-trips only valid bounded records and ignores malformed recovery metadata", () => {
    const valid = record();
    expect(parsePendingRecoveryRecords(serializePendingRecoveryRecords([valid])))
      .toEqual([valid]);
    expect(parsePendingRecoveryRecords("not json")).toEqual([]);
    expect(parsePendingRecoveryRecords(JSON.stringify([{ ...valid, automaticAttempts: 99 }]))).toEqual([]);
    expect(parsePendingRecoveryRecords(JSON.stringify([{ ...valid, imageIds: [1] }]))).toEqual([]);
  });

  it("claims no more than one bounded attempt for an exact due record", () => {
    const due = record(pending(), 1, 1_000);
    const claimed = claimPendingRecovery([due], pending(), due.id, 1_000);
    expect(claimed?.record).toMatchObject({
      automaticAttempts: 2,
      nextAttemptAt: 1_000 + PENDING_RECOVERY_BACKOFF_MS,
    });
    expect(claimed?.snapshot).toEqual(exactPendingSnapshot(pending(), "pending-target"));
    expect(claimPendingRecovery(claimed!.records, pending(), due.id, 1_000)).toBeNull();
    expect(claimPendingRecovery([due], pending(), due.id, 999)).toBeNull();
    expect(MAX_AUTOMATIC_PENDING_ATTEMPTS).toBe(2);
  });

  it("takes one finite oldest-first due snapshot and never includes exhausted or stale work", () => {
    const snapshots = Array.from({ length: 6 }, (_, index) => ({
      pendingId: `pending-${index}`,
      captureId: `capture-${index}`,
      targetId: `target-${index}`,
      revision: 1,
      source: `source-${index}`,
      inputSource: "typed" as const,
      imageIds: [] as string[],
      at: 100 + index,
    }));
    const records = snapshots.map((snapshot, index) => createPendingRecoveryRecord(
      snapshot,
      index === 4 ? MAX_AUTOMATIC_PENDING_ATTEMPTS : 0,
      index === 5 ? 10_000 : 100,
    ));
    const board: Board = {
      ...EMPTY,
      principles: [],
      actions: snapshots.map((candidate) => ({
        id: candidate.targetId,
        text: candidate.source,
        src: candidate.source,
        imgs: candidate.imageIds,
        done: false,
        at: candidate.at,
        updatedAt: candidate.at,
        shelf: "keep",
        expires: null,
        unsorted: true,
        pendingRevision: candidate.revision,
      })),
      ledger: snapshots.map((candidate) => ({
        id: candidate.pendingId,
        captureId: candidate.captureId,
        at: candidate.at,
        raw: candidate.source,
        clean: candidate.source,
        pendingSource: candidate.source,
        kind: "pending" as const,
        pendingRevision: candidate.revision,
        source: candidate.inputSource,
        targetId: candidate.targetId,
        imgs: candidate.imageIds,
      })),
    };

    expect(recoveryCandidates(records, board, 1_000).map((candidate) => candidate.targetId))
      .toEqual(["target-0", "target-1", "target-2"]);
    expect(MAX_RECOVERIES_PER_WAKE).toBe(3);
  });

  it("prunes settled, deleted, edited and remotely replaced envelopes without touching live exact work", () => {
    const live = record();
    const other = { ...live, id: "other-recovery", captureId: "other", pendingId: "other-row", targetId: "other-target" };
    expect(prunePendingRecoveryRecords([live, other], pending())).toEqual([live]);

    const edited = pending({
      actions: [{ ...pending().actions[0], text: "Manual edit", src: "Manual edit", pendingRevision: 3 }],
    });
    expect(prunePendingRecoveryRecords([live], edited)).toEqual([]);
  });

  it("revalidates the whole immutable snapshot immediately before settlement", () => {
    const snapshot = exactPendingSnapshot(pending(), "pending-target")!;
    expect(snapshotMatchesPending(snapshot, pending())).toBe(true);
    expect(snapshotMatchesPending(snapshot, pending({
      ledger: [{ ...pending().ledger[0], source: "typed" }],
    }))).toBe(false);
    expect(snapshotMatchesPending(snapshot, pending({
      actions: [{ ...pending().actions[0], imgs: ["image-two", "image-one"] }],
    }))).toBe(false);
  });
});
