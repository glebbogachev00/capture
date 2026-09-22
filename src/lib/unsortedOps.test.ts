import { describe, expect, it } from "vitest";
import { referencedImageIds } from "./imgSync";
import { EMPTY, type Action, type Board } from "./model";
import { mergeSync, stampChanges } from "./sync";
import { removeUnsortedCapture, settledLedgerEntries } from "./unsortedOps";

const waiting: Action = {
  id: "waiting",
  text: "Pending photo",
  src: "Pending photo",
  done: false,
  at: 10,
  imgs: ["pending-photo"],
  shelf: "keep",
  expires: null,
  unsorted: true,
  updatedAt: 10,
};

const board: Board = {
  ...EMPTY,
  actions: [waiting],
  ledger: [{
    id: "pending-row",
    captureId: "capture",
    at: 10,
    raw: waiting.text,
    clean: waiting.text,
    kind: "pending",
    source: "typed",
    targetId: waiting.id,
    imgs: ["pending-photo"],
  }],
};

describe("removing a waiting capture", () => {
  it("defensively excludes pre-migration action and fragment ledger rows", () => {
    const legacy: Board = {
      ...EMPTY,
      actions: [waiting],
      threads: [{
        id: "thread",
        name: "Thread",
        summary: "",
        frags: [{ id: "frag", at: 11, text: "Legacy fragment", unsorted: true }],
      }],
      ledger: [
        { ...board.ledger[0], id: "action-row", kind: "action" },
        {
          id: "frag-row",
          at: 11,
          raw: "Legacy fragment",
          clean: "Legacy fragment",
          kind: "thread",
          source: "typed",
          targetId: "thread",
          targetFragId: "frag",
        },
        {
          id: "settled-row",
          at: 12,
          raw: "Settled",
          clean: "Settled",
          kind: "action",
          source: "typed",
          targetId: "settled",
        },
      ],
    };

    expect(settledLedgerEntries(legacy).map((entry) => entry.id)).toEqual(["settled-row"]);
  });

  it("retires its photo reference through a later sync reconciliation", () => {
    const removed = removeUnsortedCapture(board, waiting)!;
    const local = stampChanges(board, removed, 20);
    const reconciled = mergeSync(
      { board: local.board, tombstones: local.tombstones },
      { board, tombstones: [] },
      20,
    ).board;

    expect(reconciled.actions).toEqual([]);
    expect(reconciled.ledger.find((entry) => entry.id === "pending-row"))
      .toMatchObject({ kind: "pending", undone: true });
    expect(referencedImageIds(reconciled)).not.toContain("pending-photo");
  });
});
