import { describe, expect, it } from "vitest";
import { EMPTY, type Action, type Board } from "./model";
import { buildManualRoutingUndo, undoManualRouting } from "./manualRoutingUndo";
import { settleManualRouting, snapshotManualPending } from "./manualRoutingSettlement";
import type { Tombstone } from "./sync";
import { mergeLedgers } from "./ledger";

const pending: Action = {
  id: "pending-action",
  text: "Exact pending source",
  src: "Exact pending source",
  done: false,
  at: 10,
  updatedAt: 10,
  imgs: ["photo"],
  shelf: "keep",
  expires: null,
  unsorted: true,
  pendingRevision: 2,
};
const before: Board = {
  ...EMPTY,
  principles: [],
  actions: [pending],
  ledger: [{
    id: "pending-row", captureId: "capture-one", at: 10,
    raw: "Raw exact source", clean: pending.text, transcript: "spoken exact source",
    kind: "pending", pendingRevision: 2, pendingSource: pending.text,
    source: "dictated", targetId: pending.id, imgs: ["photo"],
  }],
};
const beforeTombstones: Tombstone[] = [{ kind: "thread", id: "older-delete", deletedAt: 3 }];

function filed() {
  const snapshot = snapshotManualPending(before.ledger, pending)!;
  const settled = settleManualRouting(before, {
    captureId: snapshot.captureId,
    pendingId: snapshot.pendingId,
    pendingTargetId: snapshot.targetId,
    pendingSource: snapshot.source,
    pendingImageIds: snapshot.imageIds,
    pendingInputSource: snapshot.inputSource,
    revision: snapshot.revision,
    destination: { kind: "action" },
    now: 20,
  });
  if (settled.status !== "applied") throw new Error("fixture did not settle");
  return { snapshot, settled };
}

describe("manual routing inverse", () => {
  it("keeps restored pending provenance active after merging the pre-Undo ledger and allows refiling", () => {
    const { snapshot, settled } = filed();
    const record = buildManualRoutingUndo(before, beforeTombstones, snapshot, settled, "Actions");
    const reversed = undoManualRouting(settled.board, settled.tombstones, record, 30);
    if (reversed.status !== "applied") throw new Error("Undo failed");
    for (const ledger of [mergeLedgers(reversed.board.ledger, settled.board.ledger),
      mergeLedgers(settled.board.ledger, reversed.board.ledger)]) {
      const restored = ledger.filter((row) => row.kind === "pending" && !row.undone);
      expect(restored).toHaveLength(1);
      expect(restored[0]).toMatchObject({ captureId: "capture-one", targetId: pending.id,
        raw: "Raw exact source", transcript: "spoken exact source", imgs: ["photo"] });
      const refiling = settleManualRouting({ ...reversed.board, ledger }, {
        captureId: "capture-one", revision: 2, destination: { kind: "intention" }, now: 40,
      });
      expect(refiling.status).toBe("applied");
    }
  });

  it("rejects changed retired provenance or a newer deletion rather than acknowledging an incomplete restore", () => {
    const { snapshot, settled } = filed();
    const record = buildManualRoutingUndo(before, beforeTombstones, snapshot, settled, "Actions");
    const changed = { ...settled.board, ledger: settled.board.ledger.map((row) =>
      row.id === "pending-row" ? { ...row, raw: "Remote edited provenance" } : row) };
    expect(undoManualRouting(changed, settled.tombstones, record, 30).status).toBe("conflict");
    expect(undoManualRouting(settled.board,
      [{ kind: "action", id: pending.id, deletedAt: 25 }], record, 30).status).toBe("conflict");
  });
  it("restores the exact pending envelope, provenance, attachments and prior tombstones without learning", () => {
    const { snapshot, settled } = filed();
    const undo = buildManualRoutingUndo(before, beforeTombstones, snapshot, settled, "Actions");
    const result = undoManualRouting(settled.board, [...beforeTombstones, ...settled.tombstones], undo, 30);

    expect(result.status).toBe("applied");
    if (result.status !== "applied") return;
    expect(result.board.actions).toEqual([expect.objectContaining({
      ...pending,
      updatedAt: 30,
      imgs: ["photo"],
      unsorted: true,
      pendingRevision: 2,
    })]);
    expect(result.board.ledger.find((row) => row.kind === "pending" && !row.undone)).toMatchObject({
      raw: "Raw exact source", transcript: "spoken exact source", imgs: ["photo"], undone: false,
    });
    expect(result.board.ledger.find((row) => row.id === settled.ledgerId)).toMatchObject({
      settledBy: "manual", undone: true,
    });
    expect(result.board.corrections).toEqual(before.corrections);
    expect(result.tombstones).toEqual(expect.arrayContaining([
      ...beforeTombstones,
      expect.objectContaining({ kind: "action", id: settled.target.id, deletedAt: 30 }),
    ]));
    expect(result.tombstones).not.toContainEqual(
      expect.objectContaining({ kind: "action", id: pending.id, deletedAt: 20 }),
    );
  });

  it("fails closed when the exact filed artifact was edited, synced away, or already undone", () => {
    const { snapshot, settled } = filed();
    const undo = buildManualRoutingUndo(before, beforeTombstones, snapshot, settled, "Actions");
    const artifact = settled.target.id;
    const edited = {
      ...settled.board,
      actions: settled.board.actions.map((action) => action.id === artifact
        ? { ...action, text: "edited after filing", updatedAt: 25 }
        : action),
    };
    expect(undoManualRouting(edited, settled.tombstones, undo, 30)).toMatchObject({
      status: "conflict", reason: "changed",
    });
    expect(undoManualRouting({ ...settled.board, actions: [] }, settled.tombstones, undo, 30)).toMatchObject({
      status: "conflict", reason: "missing",
    });

    const once = undoManualRouting(settled.board, settled.tombstones, undo, 30);
    if (once.status !== "applied") throw new Error("first undo failed");
    expect(undoManualRouting(once.board, once.tombstones, undo, 31)).toMatchObject({
      status: "conflict",
    });
  });

  it("preserves unrelated work that arrived after filing", () => {
    const { snapshot, settled } = filed();
    const undo = buildManualRoutingUndo(before, beforeTombstones, snapshot, settled, "Actions");
    const live: Board = {
      ...settled.board,
      actions: [...settled.board.actions, {
        id: "other", text: "Remote work", done: false, at: 22, updatedAt: 22, shelf: "keep", expires: null,
      }],
    };
    const result = undoManualRouting(live, settled.tombstones, undo, 30);
    expect(result.status).toBe("applied");
    if (result.status === "applied") expect(result.board.actions.map((action) => action.id)).toEqual([
      "other", "pending-action",
    ]);
  });
});
