import { describe, expect, it } from "vitest";
import type { Action, Board, Frag, Thread } from "./model";
import { EMPTY } from "./model";
import { ORGANIZE_CAP, scanBoard } from "./organize";

/* ------------------------------ builders ------------------------------ */

const act = (id: string, text: string, at: number): Action => ({
  id,
  text,
  done: false,
  at,
  shelf: "keep",
  expires: null,
});

const frag = (id: string, text: string, at: number): Frag => ({
  id,
  at,
  text,
});

const thread = (id: string, name: string, frags: Frag[]): Thread => ({
  id,
  name,
  summary: "",
  frags,
});

const board = (b: Partial<Board>): Board => ({ ...EMPTY, ...b });

const kinds = (b: Board) => scanBoard(b).map((p) => p.kind);

/* ------------------------------ the scan ------------------------------ */

describe("scanBoard — empty and noise", () => {
  it("proposes nothing on an empty board", () => {
    expect(scanBoard(board({}))).toEqual([]);
  });

  it("proposes nothing when items share only generic words", () => {
    const b = board({
      actions: [
        act("a1", "Need to update the app settings today", 200),
        act("a2", "Update the app settings on the device", 100),
      ],
      threads: [thread("t1", "Settings", [frag("f1", "app settings", 50)])],
    });
    expect(kinds(b)).toEqual([]);
  });
});

describe("scanBoard — duplicate actions", () => {
  it("proposes dropping the newer of two identical tasks", () => {
    const b = board({
      actions: [
        act("new", "Book a dentist appointment for Tuesday", 200),
        act("old", "Book a dentist appointment for Friday", 100),
      ],
    });
    const out = scanBoard(b);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("dup_action");
    expect(out[0].sourceId).toBe("new");
    expect(out[0].targetId).toBe("old");
    expect(out[0].verb).toBe("Drop duplicate");
  });

  it("proposes exactly one per pair, never the original", () => {
    const b = board({
      actions: [
        act("new", "Book a dentist appointment for Tuesday", 300),
        act("mid", "Book a dentist appointment for Wednesday", 200),
        act("old", "Book a dentist appointment for Monday", 100),
      ],
    });
    const dups = scanBoard(b).filter((p) => p.kind === "dup_action");
    expect(dups).toHaveLength(1);
    expect(dups[0].sourceId).toBe("new");
    expect(dups[0].targetId).toBe("mid");
  });

  it("ignores faded and done actions", () => {
    const b = board({
      actions: [
        { ...act("faded", "Book a dentist appointment for Tuesday", 200), faded: true },
        act("done", "Book a dentist appointment for Friday", 150),
        act("old", "Book a dentist appointment for Monday", 100),
      ],
    });
    expect(kinds(b)).toEqual([]);
  });
});

describe("scanBoard — duplicate fragments", () => {
  it("proposes dropping the newer of two identical notes in one thread", () => {
    const b = board({
      threads: [
        thread("t1", "Coffee", [
          frag("fnew", "Espresso machine grinder calibration notes", 200),
          frag("fold", "Espresso machine grinder calibration settings", 100),
        ]),
      ],
    });
    const out = scanBoard(b);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("dup_fragment");
    expect(out[0].sourceFragId).toBe("fnew");
    expect(out[0].sourceThreadId).toBe("t1");
  });

  it("proposes across threads and names the other thread", () => {
    const b = board({
      threads: [
        thread("ta", "Coffee", [
          frag("fa", "Espresso machine grinder calibration notes", 100),
        ]),
        thread("tb", "Equipment", [
          frag("fb", "Espresso machine grinder calibration notes again", 200),
        ]),
      ],
    });
    const out = scanBoard(b).filter((p) => p.kind === "dup_fragment");
    expect(out).toHaveLength(1);
    expect(out[0].sourceFragId).toBe("fb");
    expect(out[0].targetId).toBe("ta");
    /* The cross-thread note names the kept fragment's home thread. */
    expect(out[0].targetName).toContain("Coffee");
  });

  it("needs a three-word run, not any overlap", () => {
    const b = board({
      threads: [
        thread("t1", "Coffee", [
          frag("fa", "Espresso machine grinder calibration notes", 200),
          frag("fb", "Espresso machine grinder overview", 100),
        ]),
      ],
    });
    /* "espresso machine grinder" is a shared three-word run — still a dup. */
    const out = scanBoard(b).filter((p) => p.kind === "dup_fragment");
    expect(out).toHaveLength(1);
  });
});

describe("scanBoard — fold an action into a thread", () => {
  it("proposes folding an action that shares a phrase with a thread", () => {
    const b = board({
      actions: [act("a1", "Buy cold brew equipment for the office", 200)],
      threads: [thread("t1", "Cold brew", [frag("f1", "cold brew experiments going well", 100)])],
    });
    const out = scanBoard(b);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("fold_action");
    expect(out[0].sourceId).toBe("a1");
    expect(out[0].targetId).toBe("t1");
    expect(out[0].verb).toBe("Fold in");
  });

  it("a duplicate claim wins over a fold for the same action", () => {
    const b = board({
      actions: [
        act("a1", "Buy cold brew equipment for the office", 300),
        act("a2", "Buy cold brew equipment for home", 200),
      ],
      threads: [thread("t1", "Cold brew", [frag("f1", "cold brew experiments", 100)])],
    });
    const out = scanBoard(b);
    const dups = out.filter((p) => p.kind === "dup_action");
    const folds = out.filter((p) => p.kind === "fold_action");
    expect(dups).toHaveLength(1);
    expect(dups[0].sourceId).toBe("a1");
    /* The duplicate's source is never also offered a fold, but the keeper
       (a2) may still belong in the thread — that fold is legitimately shown. */
    expect(folds.some((f) => f.sourceId === "a1")).toBe(false);
  });
});

describe("scanBoard — merge threads", () => {
  it("proposes merging two threads on the same subject, keeping the bigger", () => {
    const b = board({
      threads: [
        thread("big", "Cold brew", [
          frag("f1", "Bought a new cold brew maker", 300),
          frag("f2", "My cold brew routine runs every morning", 200),
          frag("f3", "Trying cold brew with ice", 100),
        ]),
        thread("small", "Routine", [
          frag("f4", "My cold brew routine is finally dialed", 150),
        ]),
      ],
    });
    const merges = scanBoard(b).filter((p) => p.kind === "merge_threads");
    expect(merges).toHaveLength(1);
    expect(merges[0].sourceId).toBe("small");
    expect(merges[0].targetId).toBe("big");
    expect(merges[0].verb).toBe("Merge");
  });

  it("never merges threads that merely touch on a two-word phrase", () => {
    const b = board({
      threads: [
        thread("ta", "Cold brew", [
          frag("fa", "Bought a new cold brew maker", 200),
        ]),
        thread("tb", "Brew", [
          frag("fb", "Cold brew is better than drip", 100),
        ]),
      ],
    });
    expect(kinds(b).filter((k) => k === "merge_threads")).toEqual([]);
  });

  it("ignores threads with no fragments", () => {
    const b = board({
      threads: [
        { ...thread("ta", "Cold brew routine", [frag("fa", "cold brew routine works", 200)]), frags: [] },
        thread("tb", "Routine", [frag("fb", "cold brew routine fails", 100)]),
      ],
    });
    expect(kinds(b).filter((k) => k === "merge_threads")).toEqual([]);
  });
});

describe("scanBoard — dismissal and determinism", () => {
  it("never reappears once dismissed by id", () => {
    const b = board({
      actions: [
        act("new", "Book a dentist appointment for Tuesday", 200),
        act("old", "Book a dentist appointment for Friday", 100),
      ],
    });
    const [p] = scanBoard(b);
    expect(scanBoard(b, [p.id])).toEqual([]);
  });

  it("is deterministic — same board, same ids in the same order", () => {
    const b = board({
      actions: [
        act("a1", "Book a dentist appointment for Tuesday", 200),
        act("a2", "Book a dentist appointment for Friday", 100),
      ],
      threads: [thread("t1", "Cold brew", [frag("f1", "cold brew experiments", 50)])],
    });
    const first = scanBoard(b).map((p) => p.id);
    const second = scanBoard(b).map((p) => p.id);
    expect(second).toEqual(first);
  });

  it("caps the list so the panel shows the strong claims", () => {
    const actions: Action[] = [];
    for (let i = 0; i < ORGANIZE_CAP + 1; i++) {
      const word = `gizmo${i}`;
      actions.push(act(`new${i}`, `Oversee ${word} wiring today`, 200 + i));
      actions.push(act(`old${i}`, `Oversee ${word} wiring later`, 100 + i));
    }
    const out = scanBoard(board({ actions }));
    expect(out.length).toBeLessThanOrEqual(ORGANIZE_CAP);
    expect(out.filter((p) => p.kind === "dup_action").length).toBe(
      ORGANIZE_CAP
    );
  });
});
