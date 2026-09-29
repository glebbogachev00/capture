import { describe, expect, it } from "vitest";
import { EMPTY, type Board, type Thread } from "./model";
import { semanticSortContext } from "./sortContext";

const longPrevious = `${"Previous long paragraph ".repeat(10)}\n\nSecond paragraph.`;
const longCurrent = `${"Current long paragraph ".repeat(10)}\n\nSecond paragraph.`;
const temporary: Thread = {
  id: "temporary-thread",
  name: "Temporary — Previous long paragraph",
  temporaryName: true,
  summary: "",
  frags: [{ id: "temporary-frag", at: 100, text: longPrevious }],
};

const board = (thread: Thread): Board => ({
  ...EMPTY,
  threads: [
    thread,
    { id: "stable-thread", name: "Stable Thread", summary: "Stable context", frags: [] },
  ],
  ledger: [
    {
      id: "temporary-history",
      captureId: "temporary-capture",
      at: 100,
      raw: longPrevious,
      clean: longPrevious,
      kind: "thread",
      source: "typed",
      targetId: thread.id,
      targetFragId: "temporary-frag",
      settledBy: "manual",
    },
    {
      id: "stable-history",
      captureId: "stable-capture",
      at: 90,
      raw: "Stable history",
      clean: "Stable history",
      kind: "thread",
      source: "typed",
      targetId: "stable-thread",
      settledBy: "automatic",
    },
  ],
  corrections: [{
    id: "temporary-correction",
    at: 110,
    proposalKind: "refiled",
    accepted: true,
    context: "An earlier corrected capture",
    routing: {
      kind: "thread",
      threadId: thread.id,
      threadName: thread.name,
    },
  }],
});

describe("outbound semantic Sort context", () => {
  it("omits a temporary Thread from candidates, recent targets, series, and corrections until rename", () => {
    const hidden = semanticSortContext(board(temporary), longCurrent, [], 120);
    expect(hidden.threads.map((thread) => thread.id)).toEqual(["stable-thread"]);
    expect(hidden.recent).toEqual([
      expect.objectContaining({ raw: "Stable history", target: "Stable Thread" }),
    ]);
    expect(hidden.series).toBeNull();
    expect(hidden.correctionExamples).toEqual([]);
    expect(JSON.stringify(hidden)).not.toContain("temporary-thread");
    expect(JSON.stringify(hidden)).not.toContain("Temporary — Previous long paragraph");

    const renamed = { ...temporary, name: "Renamed Thread", temporaryName: undefined };
    const visible = semanticSortContext(board(renamed), longCurrent, [], 120);
    expect(visible.threads).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "temporary-thread", name: "Renamed Thread" }),
    ]));
    expect(visible.recent[0]).toMatchObject({ target: "Renamed Thread" });
    expect(visible.series).toMatchObject({
      threadId: "temporary-thread",
      threadName: "Renamed Thread",
    });
    expect(visible.correctionExamples).toEqual([
      expect.objectContaining({ threadId: "temporary-thread", threadName: "Renamed Thread" }),
    ]);
  });
});
