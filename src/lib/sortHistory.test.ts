import { describe, expect, it } from "vitest";
import type { Board } from "./model";
import { sortHistoryContext } from "./sortHistory";

const board = (): Board => ({
  actions: [], intentions: [], principles: [], corrections: [],
  threads: [
    { id: "primary-thread", name: "Primary", summary: "", frags: [] },
    { id: "secondary-thread", name: "Secondary", summary: "", frags: [] },
  ],
  ledger: [
    {
      id: "secondary-row", captureId: "capture", primary: false, at: 10,
      raw: "One capture", clean: "Secondary share", kind: "thread", source: "typed",
      targetId: "secondary-thread",
    },
    {
      id: "primary-row", captureId: "capture", primary: true, at: 10,
      raw: "One capture", clean: "Primary share", kind: "both", source: "typed",
      targetId: "primary-thread",
    },
  ],
});

describe("sort history context", () => {
  it("counts a split once and uses its explicit primary for recent and series context", () => {
    const context = sortHistoryContext(board());
    expect(context.entries.map((entry) => entry.id)).toEqual(["primary-row"]);
    expect(context.previousThread?.id).toBe("primary-row");
    expect(context.recent).toEqual([{
      raw: "One capture",
      kind: "both",
      at: 10,
      target: "Primary",
    }]);
  });
});
