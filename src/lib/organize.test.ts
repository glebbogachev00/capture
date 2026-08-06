import { describe, expect, it } from "vitest";
import type { Action, Board, Frag, Thread } from "./model";
import { EMPTY } from "./model";
import { HIGH_CAP, scanBoard } from "./organize";

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

  it("rates a two-word overlap medium and a three-word run high", () => {
    const two = board({
      actions: [
        act("a1", "Reserve a dentist appointment for Tuesday", 200),
        act("a2", "Book a dentist appointment for Friday", 100),
      ],
    });
    expect(scanBoard(two)[0].confidence).toBe("medium");

    const three = board({
      actions: [
        act("a1", "Book a dentist appointment for Tuesday", 200),
        act("a2", "Book a dentist appointment for Tuesday", 100),
      ],
    });
    expect(scanBoard(three)[0].confidence).toBe("high");
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
    expect(out[0].confidence).toBe("high");
    expect(out[0].sourceFragId).toBe("fnew");
    expect(out[0].sourceThreadId).toBe("t1");
  });

  it("proposes across threads and names the kept thread", () => {
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
    expect(out[0].targetName).toContain("Coffee");
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
    expect(folds.some((f) => f.sourceId === "a1")).toBe(false);
  });
});

describe("scanBoard — merge threads", () => {
  it("merges two threads on the same subject (three-word phrase), keeping the bigger", () => {
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
    expect(merges[0].confidence).toBe("high");
    expect(merges[0].sourceId).toBe("small");
    expect(merges[0].targetId).toBe("big");
    expect(merges[0].verb).toBe("Merge");
  });

  it("rates a two-word phrase as a medium merge, shown behind Show more", () => {
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
    const merges = scanBoard(b).filter((p) => p.kind === "merge_threads");
    expect(merges).toHaveLength(1);
    expect(merges[0].confidence).toBe("medium");
  });

  it("merges on shared rare words even without a phrase", () => {
    /* Rare words only mean rare on a big enough board (maxShare > 2), so the
       board carries filler items that share nothing with the two threads. */
    const filler: Action[] = [];
    for (let i = 0; i < 10; i++) {
      filler.push(act(`fill${i}`, `Complete quux${i} task`, 1000 + i));
    }
    const b = board({
      actions: filler,
      threads: [
        thread("ta", "Notes", [
          frag("fa", "perfectionism and burnout and overwhelm research notes", 200),
        ]),
        thread("tb", "Reflections", [
          frag("fb", "burnout perfectionism overwhelm reflections", 100),
        ]),
      ],
    });
    const merges = scanBoard(b).filter((p) => p.kind === "merge_threads");
    expect(merges).toHaveLength(1);
    expect(merges[0].confidence).toBe("medium");
    expect(merges[0].reason).toContain("perfectionism");
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

describe("scanBoard — move a fragment to the right thread", () => {
  it("moves a misplaced note to the thread it belongs with", () => {
    const b = board({
      threads: [
        thread("career", "Career", [
          frag("fc", "Espresso machine grinder calibration notes", 200),
          frag("fc2", "Portfolio review went well", 100),
        ]),
        thread("equip", "Equipment", [
          frag("fe", "Espresso machine settings overview", 50),
        ]),
      ],
    });
    /* The move is one-way: the career fragment is misplaced (its own thread
       has nothing else on the subject), and the equipment thread keeps its
       single-fragment home — a lone fragment is a merge's claim, not a
       move's, so the directions never propose each other. */
    const moves = scanBoard(b).filter((p) => p.kind === "move_fragment");
    expect(moves).toHaveLength(1);
    expect(moves[0].confidence).toBe("medium");
    expect(moves[0].sourceThreadId).toBe("career");
    expect(moves[0].sourceFragId).toBe("fc");
    expect(moves[0].targetId).toBe("equip");
    expect(moves[0].verb).toBe("Move");
  });

  it("never moves a fragment that also matches its own thread", () => {
    const b = board({
      threads: [
        thread("a", "Cold brew", [
          frag("fa", "Cold brew experiments with new beans", 200),
          frag("fb", "cold brew routine notes", 100),
        ]),
        thread("c", "Routine", [
          frag("fc", "cold brew routine overview", 50),
        ]),
      ],
    });
    expect(kinds(b).filter((k) => k === "move_fragment")).toEqual([]);
  });
});

describe("scanBoard — extract a task out of a fragment", () => {
  it("extracts a fragment that opens with a task marker", () => {
    const b = board({
      threads: [
        thread("t1", "Vet", [
          frag("f1", "I need to call the vet about Luna's shots", 100),
        ]),
      ],
    });
    const extracts = scanBoard(b).filter((p) => p.kind === "extract_action");
    expect(extracts).toHaveLength(1);
    expect(extracts[0].confidence).toBe("medium");
    expect(extracts[0].sourceFragId).toBe("f1");
    expect(extracts[0].verb).toBe("Extract");
  });

  it("never extracts a fragment that does not read as a task", () => {
    const b = board({
      threads: [
        thread("t1", "Market", [
          frag("f1", "The market seems fine today", 100),
        ]),
      ],
    });
    expect(kinds(b).filter((k) => k === "extract_action")).toEqual([]);
  });

  it("never extracts frame phrases like 'I have to admit' or 'Please note'", () => {
    const b = board({
      threads: [
        thread("t1", "Notes", [
          frag("f1", "I have to admit the market looks fine", 100),
          frag("f2", "Please note the deadline moved", 90),
        ]),
      ],
    });
    expect(kinds(b).filter((k) => k === "extract_action")).toEqual([]);
  });

  it("a duplicate source is never also moved or extracted", () => {
    /* fb duplicates fa (three-word run) → dup claims fb, so the copy is
       never also offered as a move or an extract even though it reads like
       a task. The KEPT original (fa) may still earn its own proposals. */
    const b = board({
      threads: [
        thread("ta", "Notes", [
          frag("fa", "I need to call the vet about Luna's shots", 100),
          frag("fb", "I need to call the vet about Luna's shots again", 200),
        ]),
      ],
    });
    const out = scanBoard(b);
    const dups = out.filter((p) => p.kind === "dup_fragment");
    expect(dups).toHaveLength(1);
    expect(dups[0].sourceFragId).toBe("fb");
    expect(out.filter((p) => p.kind === "move_fragment")).toEqual([]);
    /* The kept original can be extracted — that is a separate, valid claim. */
    const extracts = out.filter((p) => p.kind === "extract_action");
    expect(extracts.map((p) => p.sourceFragId)).toEqual(["fa"]);
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

  it("caps strong claims first, medium behind them", () => {
    const actions: Action[] = [];
    for (let i = 0; i < HIGH_CAP + 1; i++) {
      const word = `gizmo${i}`;
      actions.push(act(`new${i}`, `Oversee ${word} wiring today`, 200 + i));
      actions.push(act(`old${i}`, `Oversee ${word} wiring later`, 100 + i));
    }
    const out = scanBoard(board({ actions }));
    expect(out.length).toBe(HIGH_CAP);
    expect(out.every((p) => p.confidence === "high")).toBe(true);
  });
});
