import { describe, expect, it } from "vitest";
import {
  applyActionDone,
  applyActionFold,
  applyActionToNewThread,
} from "./actionOps";
import { REFILE_WINDOW_MS } from "./refiled";
import type { Board } from "./model";

const T0 = 1_756_000_000_000;
function board(): Board {
  return {
    actions: [
      {
        id: "a1",
        text: "Record a Retake demo of the new features",
        done: false,
        at: T0,
        src: "I should record a retake demo going over all the features we added",
        imgs: ["img-3"],
        shelf: "keep",
        expires: null,
        threadId: "retake",
      },
      {
        id: "a2",
        text: "Rotate the Upstash token",
        done: false,
        at: T0 + 1000,
        shelf: "keep",
        expires: null,
      },
    ],
    intentions: [],
    principles: [],
    completions: [],
    threads: [
      {
        id: "retake",
        name: "Retake",
        summary: "Demo tool: agent-first engine plus a review window.",
        frags: [
          { id: "r1", at: T0 - 60_000, text: "Retake demos show the app as it is, no overlays." },
        ],
      },
    ],
  } as unknown as Board;
}

describe("ticking an action", () => {
  it("removes the row but keeps the fact", () => {
    /* Before the receipt existed, a day of finishing things left the same
       trace as a day of none. */
    const out = applyActionDone(board(), "a1", T0 + 5000)!;
    expect(out.board.actions.map((a) => a.id)).toEqual(["a2"]);
    expect(out.board.completions).toEqual([
      { id: "a1", text: "Record a Retake demo of the new features", at: T0 + 5000, threadId: "retake" },
    ]);
  });

  it("a fast double-tap writes one receipt, not two", () => {
    const first = applyActionDone(board(), "a1", T0 + 5000)!;
    expect(applyActionDone(first.board, "a1", T0 + 5001)).toBeNull();
  });

  it("hands the photos back instead of dropping them itself", () => {
    /* The old order deleted photos first — a failed commit left the action
       alive, pictures gone. The caller drops them after the board holds. */
    expect(applyActionDone(board(), "a1", T0)!.imgs).toEqual(["img-3"]);
  });
});

describe("turning an action into its own thread", () => {
  it("the fragment keeps the words as said, not the rewritten task", () => {
    const out = applyActionToNewThread(board(), "a1", (() => { let n = 0; return () => `id-${++n}`; })())!;
    const fresh = out.board.threads[0];
    expect(fresh.frags[0].text).toMatch(/^I should record a retake demo/);
    expect(fresh.name).toBe("Record a Retake demo of");
    expect(out.board.actions.some((a) => a.id === "a1")).toBe(false);
  });

  it("an already-consumed action is a no-op", () => {
    expect(applyActionToNewThread(board(), "gone", () => "x")).toBeNull();
  });
});

describe("folding an action into a thread", () => {
  it("the note lands in time order and the task retires", () => {
    const out = applyActionFold(board(), "a1", "retake", T0 + REFILE_WINDOW_MS + 1, () => "new-frag")!;
    const t = out.board.threads[0];
    expect(t.frags.map((f) => f.id)).toEqual(["r1", "new-frag"]);
    expect(t.frags[1].text).toMatch(/^I should record/);
    expect(out.board.actions.some((a) => a.id === "a1")).toBe(false);
    expect(out.already).toBe(false);
  });

  it("never duplicates: a thread that already holds the note gets nothing appended", () => {
    /* Extraction leaves the note in its thread, so the extracted action
       folds back into the very fragment it came from. This guard is what
       lets approve-all run: however stale the proposal, copies cannot
       stack. */
    const b = board();
    b.threads[0].frags.push({ id: "r2", at: T0, text: "I should record a retake demo going over all the features we added" });
    const out = applyActionFold(b, "a1", "retake", T0 + 1, () => "new-frag")!;
    expect(out.already).toBe(true);
    expect(out.board.threads[0].frags).toHaveLength(2); // unchanged
    expect(out.board.actions.some((a) => a.id === "a1")).toBe(false); // but the task still retires
  });

  it("a fold moments after the sort teaches the sorter; an old one is housekeeping", () => {
    const fresh = applyActionFold(board(), "a1", "retake", T0 + REFILE_WINDOW_MS, () => "f")!;
    expect(fresh.lesson).toMatch(/belong in "Retake"/);
    const old = applyActionFold(board(), "a1", "retake", T0 + REFILE_WINDOW_MS + 1, () => "f")!;
    expect(old.lesson).toBeNull();
  });

  it("a thread merged away on the other device makes the fold a no-op", () => {
    const b = board();
    b.threads = [];
    expect(applyActionFold(b, "a1", "retake", T0, () => "f")).toBeNull();
  });
});
