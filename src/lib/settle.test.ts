import { describe, expect, it } from "vitest";
import { EMPTY, type Board } from "./model";
import { recordSortedCapture, settleUnsortedCapture } from "./settle";

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
    /* The banner frames this as "Landed in <receipt>." — the receipt must
       complete that sentence, not start its own ("Landed in Kept in
       Actions" shipped, and was read on camera). */
    expect(out.receipt).toMatch(/^Actions, unsorted/);
    expect("Landed in " + out.receipt + ".").toMatch(
      /^Landed in Actions, unsorted — sort it when the model is back\.$/
    );
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

  it("keeps the original capture identity when a correction is saved unsorted", () => {
    const out = settleUnsortedCapture(board(), input(), {
      ...ids,
      captureId: "original-capture",
    });
    expect(out.board.ledger![0].captureId).toBe("original-capture");
  });

  it("carries every field the Board declares", () => {
    const b = board({ wraps: [{ day: "2026-08-30", text: "short", at: 5 }] as never, historyEpoch: 3 });
    const out = settleUnsortedCapture(b, input(), ids).board as unknown as Record<string, unknown>;
    for (const key of Object.keys(EMPTY)) {
      expect(out[key], `settlement dropped Board.${key}`).toBeDefined();
    }
  });
});

describe("recording a successful capture", () => {
  const facts = (over = {}) => ({
    raw: "retake is slow on my machine and capture keeps mis-sorting",
    payload: "retake is slow on my machine and capture keeps mis-sorting",
    at: 100,
    dictated: true,
    imgIds: [] as string[],
    captureId: "cap1",
    kind: "thread" as const,
    clean: "Retake is slow on my machine and Capture keeps mis-sorting.",
    primaryText: "Retake is slow on my machine.",
    via: "groq",
    primary: { targetId: "t-retake", fragId: "f1" },
    also: [{ text: "Capture keeps mis-sorting.", threadId: "t-capture", fragId: "f2" }],
    ...over,
  });

  let n = 0;
  const mkId = () => "id" + n++;

  it("a split counts each share once — never the whole sentence twice", () => {
    n = 0;
    const { board } = recordSortedCapture({ ...EMPTY }, facts(), mkId);
    const primary = board.ledger!.find((e) => e.targetId === "t-retake")!;
    const other = board.ledger!.find((e) => e.targetId === "t-capture")!;
    expect(primary.clean).toBe("Retake is slow on my machine.");
    expect(other.clean).toBe("Capture keeps mis-sorting.");
    /* One utterance, one captureId, however many destinations. */
    expect(primary.captureId).toBe(other.captureId);
  });

  it("no split: the primary entry keeps the whole cleaned text", () => {
    n = 0;
    const { board } = recordSortedCapture(
      { ...EMPTY },
      facts({ also: [], primaryText: null }),
      mkId
    );
    expect(board.ledger![0].clean).toBe(
      "Retake is slow on my machine and Capture keeps mis-sorting."
    );
  });

  it("every reached thread is named for a summary refresh, once", () => {
    n = 0;
    const { summaryTargets } = recordSortedCapture({ ...EMPTY }, facts(), mkId);
    expect(summaryTargets.sort()).toEqual(["t-capture", "t-retake"]);
    /* The primary landing twice in the list would refresh it twice. */
    const dup = recordSortedCapture(
      { ...EMPTY },
      facts({ also: [{ text: "x", threadId: "t-retake", fragId: "f9" }] }),
      mkId
    );
    expect(dup.summaryTargets).toEqual(["t-retake"]);
  });

  it("entries and targets describe the same landing", () => {
    n = 0;
    const { board } = recordSortedCapture({ ...EMPTY }, facts(), mkId);
    const primary = board.ledger!.find((e) => e.targetId === "t-retake")!;
    expect(primary.targetFragId).toBe("f1");
    expect(board.ledger!.some((e) => e.targetId === "t-capture")).toBe(true);
  });
});
