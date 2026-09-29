import { describe, expect, it, vi } from "vitest";
import { EMPTY, type Action, type Board } from "./model";
import { createManualRoutingOperations } from "./manualRoutingOperations";
import { snapshotManualPending } from "./manualRoutingSettlement";
import { PlannedSortAuthority } from "./plannedSortAuthority";

const at = 1_800_000_000_000;
const source = "One.Two.";
const pending: Action = {
  id: "pending-action",
  text: source,
  src: source,
  done: false,
  at,
  imgs: [],
  shelf: "keep",
  expires: null,
  unsorted: true,
  pendingRevision: 1,
};
const other: Action = { ...pending, id: "other-action" };
const board: Board = {
  ...EMPTY,
  principles: [],
  actions: [pending, other],
  ledger: [{
    id: "pending-row",
    captureId: "capture-one",
    at,
    raw: source,
    clean: source,
    kind: "pending",
    pendingRevision: 1,
    pendingSource: source,
    source: "typed",
    targetId: pending.id,
  }],
};

const segments = [
  { id: "one", sourceOrder: 0, text: "One.", destination: { kind: "action" } as const },
  { id: "two", sourceOrder: 1, text: "Two.", destination: { kind: "pending" } as const },
];

describe("manual routing operation identity", () => {
  it("refuses a split when the shown card is not the exact snapshotted target", async () => {
    let current = board;
    const splitApplied = vi.fn();
    const operations = createManualRoutingOperations({
      read: () => current,
      authority: new PlannedSortAuthority(),
      transact: async (build) => {
        const mutation = build(current, []);
        if ("skip" in mutation) return { status: "skipped", value: mutation.skip };
        current = mutation.next;
        return { status: "committed", value: mutation.value, board: current, tombstones: [] };
      },
      now: () => at + 1,
      fail: vi.fn(),
      staleDestination: vi.fn(),
      routingApplied: vi.fn(),
      splitApplied,
    });
    const snapshot = snapshotManualPending(board.ledger, pending)!;

    const applied = await operations.manualSplit(other, segments, snapshot);

    expect(applied).toBe(false);
    expect(current).toBe(board);
    expect(splitApplied).not.toHaveBeenCalled();
  });
});
