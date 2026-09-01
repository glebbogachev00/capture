import { describe, expect, it } from "vitest";
import {
  applyFragDelete,
  applyFragEdit,
  applyFragMove,
  applyFragResolve,
  applyFragSplit,
} from "./fragOps";
import { REFILE_WINDOW_MS } from "./refiled";
import type { Board } from "./model";

/** A board in this person's own vocabulary: two threads, notes with real
    timestamps, an image on one note. */
const T0 = 1_756_000_000_000;
function board(): Board {
  return {
    actions: [],
    intentions: [],
    principles: [],
    threads: [
      {
        id: "retake",
        name: "Retake",
        summary: "Demo tool: agent-first engine plus a review window.",
        frags: [
          { id: "r1", at: T0, text: "Retake demos should show the app as it is, no overlays." },
          { id: "r2", at: T0 + 60_000, text: "Release notes habit: plain-language what's new on every major update.", imgs: ["img-9"] },
        ],
      },
      {
        id: "capture",
        name: "Capture.",
        summary: "The board itself — capture, sort, threads.",
        frags: [
          { id: "c1", at: T0 + 30_000, text: "Let capture import from notes, notion, google keep." },
        ],
      },
    ],
  } as unknown as Board;
}

describe("editing a note", () => {
  it("a save that changed nothing does nothing — no model call, no push", () => {
    expect(applyFragEdit(board(), "retake", "r1", "Retake demos should show the app as it is, no overlays.")).toBeNull();
  });

  it("a real edit lands on the note and only that note", () => {
    const next = applyFragEdit(board(), "retake", "r1", "Demos show the app as it is.");
    expect(next!.threads[0].frags[0].text).toBe("Demos show the app as it is.");
    expect(next!.threads[0].frags[1].text).toMatch(/Release notes habit/);
    expect(next!.threads[1].frags[0].text).toMatch(/notion/);
  });

  it("a stale typo-fix never clobbers a newer edit", () => {
    /* The proofread runs after the save and comes back late. By then the
       person may have edited again — the fix may only land on the exact
       text it checked. */
    const b = applyFragEdit(board(), "retake", "r1", "Demos show the app as it is.")!;
    const fixed = applyFragEdit(b, "retake", "r1", "Demos show the app as it was.", "Retake demos should show the app as it is, no overlays.");
    expect(fixed).toBeNull(); // the note moved on; the stale fix bounces
    const onTime = applyFragEdit(b, "retake", "r1", "Demos show the app as-is.", "Demos show the app as it is.");
    expect(onTime!.threads[0].frags[0].text).toBe("Demos show the app as-is.");
  });
});

describe("deleting a note", () => {
  it("a fast double-tap consumes the note once", () => {
    const first = applyFragDelete(board(), "retake", "r1")!;
    expect(applyFragDelete(first.board, "retake", "r1")).toBeNull();
  });

  it("hands back the images so storage can drop them", () => {
    expect(applyFragDelete(board(), "retake", "r2")!.imgs).toEqual(["img-9"]);
  });

  it("the last note takes its thread with it — a thread with nothing in it is just a name", () => {
    const out = applyFragDelete(board(), "capture", "c1")!;
    expect(out.removedThread).toBe(true);
    expect(out.board.threads.map((t) => t.id)).toEqual(["retake"]);
  });
});

describe("moving a note between threads", () => {
  it("lands in time order, not at the end", () => {
    /* c1 (T0+30s) belongs between r1 (T0) and r2 (T0+60s). Appending it
       last would read the thread's story out of order. */
    const out = applyFragMove(board(), "capture", "c1", "retake", T0 + 40_000)!;
    const dest = out.board.threads.find((t) => t.id === "retake")!;
    expect(dest.frags.map((f) => f.id)).toEqual(["r1", "c1", "r2"]);
  });

  it("emptying the source removes it", () => {
    const out = applyFragMove(board(), "capture", "c1", "retake", T0 + 40_000)!;
    expect(out.emptied).toBe(true);
    expect(out.board.threads.some((t) => t.id === "capture")).toBe(false);
  });

  it("a move within minutes of landing teaches the sorter; an old note is just housekeeping", () => {
    /* The real scenario: the sorter filed a Retake note into Capture, and
       the person drags it home while the mistake is still warm. The note
       shares its subject with the destination, so there is a rule worth
       writing. */
    const b = board();
    b.threads.find((t) => t.id === "capture")!.frags.push({
      id: "mis1",
      at: T0,
      text: "Retake demos need release notes on every major update.",
    });
    const fresh = applyFragMove(b, "capture", "mis1", "retake", T0 + REFILE_WINDOW_MS)!;
    expect(fresh.lesson).toMatch(/belong in "Retake"/);
    const old = applyFragMove(b, "capture", "mis1", "retake", T0 + REFILE_WINDOW_MS + 1)!;
    expect(old.lesson).toBeNull();
  });

  it("a destination merged away on another device makes the move a no-op", () => {
    const b = board();
    b.threads = b.threads.filter((t) => t.id !== "retake");
    expect(applyFragMove(b, "capture", "c1", "retake", T0)).toBeNull();
    expect(applyFragMove(board(), "retake", "r1", "retake", T0)).toBeNull(); // and never into itself
  });
});

describe("splitting a note into its own thread", () => {
  it("names the new thread from the note's first words and puts it where the eye lands", () => {
    const out = applyFragSplit(board(), "retake", "r2", () => "fresh-id")!;
    expect(out.board.threads[0]).toMatchObject({
      id: "fresh-id",
      name: "Release notes habit: plain-language what's",
    });
    expect(out.board.threads[0].frags.map((f) => f.id)).toEqual(["r2"]);
    expect(out.board.threads.find((t) => t.id === "retake")!.frags.map((f) => f.id)).toEqual(["r1"]);
  });

  it("splitting out the only note removes the husk it leaves", () => {
    const out = applyFragSplit(board(), "capture", "c1", () => "fresh-id")!;
    expect(out.emptied).toBe(true);
    expect(out.board.threads.some((t) => t.id === "capture")).toBe(false);
  });
});

describe("labeling a note resolved", () => {
  const withAction = () => {
    const b = board();
    b.actions = [
      {
        id: "a-demo",
        text: "Record a Retake demo of the new features",
        done: false,
        at: T0,
        src: "Retake demos should show the app as it is, no overlays.",
        shelf: "keep",
        expires: null,
        threadId: "retake",
      },
    ] as unknown as typeof b.actions;
    b.completions = [];
    return b;
  };

  it("the note stays in its thread — labeled, never deleted", () => {
    const out = applyFragResolve(board(), "retake", "r1", T0 + 5000)!;
    const t = out.board.threads.find((x) => x.id === "retake")!;
    expect(t.frags.map((f) => f.id)).toContain("r1"); // still there
    expect(t.frags.find((f) => f.id === "r1")!.resolvedAt).toBe(T0 + 5000);
  });

  it("a double tap labels once — the second gesture is a no-op", () => {
    const first = applyFragResolve(board(), "retake", "r1", T0 + 5000)!;
    expect(applyFragResolve(first.board, "retake", "r1", T0 + 6000)).toBeNull();
  });

  it("the open action born from the note is ticked in the same gesture", () => {
    /* The action's src IS the note's words — one decision resolves both
       faces of the same capture, receipt kept. */
    const out = applyFragResolve(withAction(), "retake", "r1", T0 + 5000)!;
    expect(out.tickedActionText).toMatch(/Record a Retake demo/);
    expect(out.board.actions).toHaveLength(0);
    expect(out.board.completions!.map((c) => c.id)).toEqual(["a-demo"]);
  });

  it("an unrelated action in the same thread is left alone", () => {
    const b = withAction();
    b.actions[0].src = "Buy a new microphone for the recordings";
    b.actions[0].text = "Buy a new microphone";
    const out = applyFragResolve(b, "retake", "r1", T0 + 5000)!;
    expect(out.tickedActionText).toBeNull();
    expect(out.board.actions).toHaveLength(1);
  });
});
