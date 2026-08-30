import { describe, expect, it } from "vitest";
import { EMPTY, type Board } from "./model";
import { settleUnsortedCapture } from "./settle";

/**
 * The settlement's one invariant, tested as behavior: the board, the
 * history entry, the receipt, and the target facts must describe the SAME
 * event. The bug this replaces had the board creating an action while the
 * history said "thread", because the two were computed by different lines
 * — one of which read the visible tab. This function's signature has no
 * tab parameter, so that class of disagreement is unwritable.
 */

const ids = { itemId: "item1", ledgerId: "led1" };

const board = (over: Partial<Board> = {}): Board => ({ ...EMPTY, ...over });

const input = (over = {}) => ({
  raw: "I need to test both capture and retake well and create a good dev workflow",
  imgIds: [] as string[],
  at: 100,
  dictated: true,
  ...over,
});

describe("settling a capture the sorter could not sort", () => {
  it("no chosen destination: an unsorted ACTION, and the record agrees", () => {
    /* The radar's acceptance case: Threads tab visible, nothing open —
       the tab must not exist as far as this decision is concerned. */
    const out = settleUnsortedCapture(board(), input(), ids);
    expect(out.target.kind).toBe("action");
    expect(out.board.actions[0].unsorted).toBe(true);
    expect(out.board.threads).toHaveLength(0);
    /* The history entry describes the same event. */
    const entry = out.board.ledger!.find((e) => e.id === "led1")!;
    expect(entry.kind).toBe("action");
    expect(entry.targetId).toBe(out.target.id);
    expect(out.receipt).toMatch(/Kept in Actions, unsorted/);
  });

  it("an open thread is a chosen destination: fragment there, record says thread", () => {
    const b = board({
      threads: [
        { id: "t1", name: "Reality Creation Game", at: 1, frags: [] } as never,
      ],
    });
    const out = settleUnsortedCapture(b, input({ openThreadId: "t1" }), ids);
    expect(out.target).toEqual({ kind: "thread", id: "t1", fragId: "item1" });
    const t = out.board.threads[0];
    expect(t.frags).toHaveLength(1);
    expect(t.frags[0].unsorted).toBe(true);
    const entry = out.board.ledger!.find((e) => e.id === "led1")!;
    expect(entry.kind).toBe("thread");
    expect(entry.targetId).toBe("t1");
    expect(entry.targetFragId).toBe("item1");
    expect(out.receipt).toBe("Reality Creation Game — saved unsorted");
  });

  it("never invents a thread, whatever the failure", () => {
    const out = settleUnsortedCapture(board(), input(), ids);
    expect(out.board.threads).toHaveLength(0);
  });

  it("an open thread that no longer exists falls back to the action park", () => {
    /* The thread could have been deleted on another device between the
       capture starting and failing. A stale choice is no choice. */
    const out = settleUnsortedCapture(board(), input({ openThreadId: "gone" }), ids);
    expect(out.target.kind).toBe("action");
    expect(out.board.ledger![0].kind).toBe("action");
  });

  it("the words survive exactly, photos and all", () => {
    const out = settleUnsortedCapture(
      board(),
      input({ imgIds: ["img1"], raw: "the covers disappear during sorting" }),
      ids
    );
    expect(out.board.actions[0].text).toBe("the covers disappear during sorting");
    expect(out.board.actions[0].imgs).toEqual(["img1"]);
    expect(out.board.ledger![0].imgs).toEqual(["img1"]);
  });

  it("carries every field the Board declares", () => {
    const b = board({ wraps: [{ day: "2026-08-30", text: "short", at: 5 }] as never, historyEpoch: 3 });
    const out = settleUnsortedCapture(b, input(), ids).board as unknown as Record<string, unknown>;
    for (const key of Object.keys(EMPTY)) {
      expect(out[key], `settlement dropped Board.${key}`).toBeDefined();
    }
  });
});
