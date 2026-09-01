import { describe, expect, it } from "vitest";
import { applySorted, byRecency, type SortResult } from "./boardOps";
import { EMPTY, type Board, type Thread } from "./model";

const base = (over: Partial<Board> = {}): Board => ({ ...EMPTY, ...over });

const thread = (id: string, name: string, frags: Thread["frags"] = []): Thread => ({
  id,
  name,
  summary: "",
  frags,
  updatedAt: 1000,
});

const sorted = (over: Partial<SortResult>): SortResult => ({
  clean: "cleaned text",
  kind: "action",
  title: "A title",
  actions: [],
  shelfLife: "keep",
  threadId: null,
  threadName: null,
  ...over,
});

describe("applySorted — action", () => {
  it("creates one action per item, newest ahead of the board", () => {
    const board = base();
    const { next, targetId, source } = applySorted(
      sorted({ kind: "action", actions: ["Call the vet", "Buy food"] }),
      [],
      500,
      board
    );
    expect(next.actions.map((a) => a.text)).toEqual(["Call the vet", "Buy food"]);
    expect(targetId).toBe(null);
    // Several actions are never offered a thread home; only a lone one is.
    expect(source).toBe(null);
  });

  it("offers a home only for a single action", () => {
    const { source } = applySorted(
      sorted({ kind: "action", actions: ["Just one"] }),
      [],
      500,
      base()
    );
    expect(source).toEqual({ kind: "action", id: expect.any(String) });
  });

  it("falls back to the title when no items are given", () => {
    const { next } = applySorted(
      sorted({ kind: "action", actions: [], title: "Do the thing" }),
      [],
      500,
      base()
    );
    expect(next.actions[0].text).toBe("Do the thing");
  });
});

describe("applySorted — thread", () => {
  it("appends a fragment to the matched existing thread", () => {
    const board = base({ threads: [thread("t1", "Studio")] });
    const { next, targetId } = applySorted(
      sorted({ kind: "thread", threadId: "t1", clean: "a new note" }),
      [],
      500,
      board
    );
    expect(next.threads).toHaveLength(1);
    expect(next.threads[0].frags.map((f) => f.text)).toEqual(["a new note"]);
    expect(targetId).toBe("t1");
  });

  it("starts a fresh thread when nothing matches", () => {
    const { next, targetId } = applySorted(
      sorted({ kind: "thread", threadId: null, threadName: "New topic", clean: "seed" }),
      [],
      500,
      base()
    );
    expect(next.threads[0].name).toBe("New topic");
    expect(next.threads[0].frags[0].text).toBe("seed");
    expect(targetId).toBe(next.threads[0].id);
  });
});

describe("applySorted — both", () => {
  it("creates the action AND a thread, with images only on the fragment", () => {
    const { next, targetId, source } = applySorted(
      sorted({
        kind: "both",
        actions: ["Renew the domain"],
        threadName: "Rebrand?",
        clean: "still deciding on the rebrand",
      }),
      ["img1"],
      500,
      base()
    );
    expect(next.actions.map((a) => a.text)).toEqual(["Renew the domain"]);
    // The action carries no image — closing it must never drop the thread's.
    expect(next.actions[0].imgs).toEqual([]);
    expect(next.threads[0].name).toBe("Rebrand?");
    expect(next.threads[0].frags[0].imgs).toEqual(["img1"]);
    expect(targetId).toBe(next.threads[0].id);
    expect(source).toEqual({
      kind: "thread",
      id: next.threads[0].id,
      fragId: next.threads[0].frags[0].id,
    });
  });

  it("routes the thinking into an existing thread when one is named", () => {
    const board = base({ threads: [thread("t9", "Rebrand")] });
    const { next, targetId } = applySorted(
      sorted({ kind: "both", actions: ["Renew domain"], threadId: "t9", clean: "more thinking" }),
      [],
      500,
      board
    );
    expect(next.threads).toHaveLength(1);
    expect(next.threads[0].frags.map((f) => f.text)).toEqual(["more thinking"]);
    expect(next.actions).toHaveLength(1);
    expect(targetId).toBe("t9");
  });
});

import { computeSuggestion } from "./boardOps";
import type { Action } from "./model";

const action = (id: string, text: string, over: Partial<Action> = {}): Action => ({
  id,
  text,
  done: false,
  at: 1000,
  shelf: "keep",
  expires: null,
  ...over,
});

describe("computeSuggestion — guards", () => {
  it("returns null with no source", () => {
    expect(computeSuggestion(base(), "anything", null)).toBe(null);
  });
  it("returns null on empty text", () => {
    expect(
      computeSuggestion(base(), "   ", { kind: "action", id: "a1" })
    ).toBe(null);
  });
});

describe("computeSuggestion — duplicate action", () => {
  it("proposes dropping a re-captured task that matches a live action", () => {
    const board = base({
      actions: [
        action("new", "Call the vet about Luna's shots"),
        action("old", "Call the vet about Luna's shots"),
      ],
    });
    const s = computeSuggestion(board, "Call the vet about Luna's shots", {
      kind: "action",
      id: "new",
    });
    expect(s?.kind).toBe("duplicate");
    expect(s?.targetId).toBe("old");
  });

  it("does not fire when the only match is a faded action (a refresh, not a dup)", () => {
    const board = base({
      actions: [
        action("new", "Renew the passport"),
        action("old", "Renew the passport", { faded: true }),
      ],
    });
    const s = computeSuggestion(board, "Renew the passport", {
      kind: "action",
      id: "new",
    });
    // Faded counterpart → not offered as a duplicate.
    expect(s?.kind).not.toBe("duplicate");
  });
});

describe("byRecency — threads in the order you actually use them", () => {
  const t = (id: string, fragAt: number[]): Thread => ({
    id,
    name: id,
    summary: "",
    frags: fragAt.map((at, i) => ({ id: `${id}-${i}`, at, text: "n" })),
  });

  it("puts the most recently added-to thread first, whatever its age", () => {
    /* `old` was created long ago but fed this morning; `young` was made
       yesterday and never touched since. The old one should lead. */
    const old = t("old", [1_000, 9_000]);
    const young = t("young", [5_000]);
    expect([young, old].sort(byRecency).map((x) => x.id)).toEqual(["old", "young"]);
  });

  it("a thread with no fragments yet falls back to its own stamp", () => {
    const empty: Thread = { id: "empty", name: "e", summary: "", frags: [], updatedAt: 8_000 };
    const fed = t("fed", [3_000]);
    expect([fed, empty].sort(byRecency).map((x) => x.id)).toEqual(["empty", "fed"]);
  });

  it("is a total order — equal recency does not throw or drop threads", () => {
    const a = t("a", [500]);
    const b = t("b", [500]);
    expect([a, b].sort(byRecency)).toHaveLength(2);
  });
});

describe("applySorted — a picture that arrives with a task", () => {
  /* An action cannot show an image: nothing renders one, and ticking the
     action off would take the picture with it. So the capture lands twice
     — the image on a thread fragment that keeps it, the task as an action
     that points back at it. */

  it("keeps the picture on a fragment and points the action at it", () => {
    const { next, targetId } = applySorted(
      sorted({ kind: "action", title: "Fix the leak", clean: "Fix the leak" }),
      ["img-1"],
      500,
      base()
    );
    expect(next.actions).toHaveLength(1);
    /* The action never owns the image — deleting it must not drop a picture
       the thread is still showing. */
    expect(next.actions[0].imgs).toEqual([]);

    expect(next.threads).toHaveLength(1);
    const frag = next.threads[0].frags[0];
    expect(frag.imgs).toEqual(["img-1"]);
    expect(next.actions[0].shot).toEqual({
      threadId: next.threads[0].id,
      fragId: frag.id,
    });
    expect(targetId).toBe(next.threads[0].id);
  });

  it("prefers a thread the sorter named over opening a new one", () => {
    const board = base({ threads: [thread("t1", "Kitchen renovation")] });
    const { next } = applySorted(
      sorted({ kind: "action", title: "Fix the leak", threadId: "t1" }),
      ["img-1"],
      500,
      board
    );
    expect(next.threads).toHaveLength(1);
    expect(next.threads[0].id).toBe("t1");
    expect(next.threads[0].frags[0].imgs).toEqual(["img-1"]);
    expect(next.actions[0].shot?.threadId).toBe("t1");
  });

  it("points every action at the one picture when a capture holds several", () => {
    const { next } = applySorted(
      sorted({
        kind: "action",
        title: "two things",
        actions: ["Call the plumber", "Order the part"],
      }),
      ["img-1"],
      500,
      base()
    );
    expect(next.actions).toHaveLength(2);
    const fragId = next.threads[0].frags[0].id;
    for (const a of next.actions) {
      expect(a.imgs).toEqual([]);
      expect(a.shot?.fragId).toBe(fragId);
    }
    /* One picture, one fragment — not a copy per action. */
    expect(next.threads[0].frags).toHaveLength(1);
  });

  it("changes nothing when a capture has no picture", () => {
    const { next, targetId, source } = applySorted(
      sorted({ kind: "action", title: "Fix the leak" }),
      [],
      500,
      base()
    );
    expect(next.threads).toHaveLength(0);
    expect(next.actions[0].shot).toBeUndefined();
    expect(targetId).toBeNull();
    /* A plain lone action is still offered a thread to fold into. */
    expect(source).toEqual({ kind: "action", id: next.actions[0].id });
  });

  it("says where the picture went", () => {
    const board = base({ threads: [thread("t1", "Kitchen renovation")] });
    const { landed } = applySorted(
      sorted({ kind: "action", title: "Fix the leak", threadId: "t1" }),
      ["img-1"],
      500,
      board
    );
    expect(landed).toContain("Kitchen renovation");
  });
});

describe("applySorted — a capture that is both a task and thinking", () => {
  it("calls a thread it just made a new thread, not a layer", () => {
    /* "A layer on X" describes a history that does not exist when the
       thread was created by this very capture, and reads as though the
       capture joined something already under way. */
    const { landed } = applySorted(
      sorted({
        kind: "both",
        title: "Pricing",
        threadName: "Pricing the new tier",
        actions: ["Fix the signup bug"],
      }),
      [],
      500,
      base()
    );
    expect(landed).toContain("a new thread");
    expect(landed).not.toContain("a layer on");
  });

  it("calls it a layer when the thread was already there", () => {
    const board = base({ threads: [thread("t1", "Pricing the new tier")] });
    const { landed } = applySorted(
      sorted({
        kind: "both",
        title: "Pricing",
        threadId: "t1",
        actions: ["Fix the signup bug"],
      }),
      [],
      500,
      board
    );
    expect(landed).toContain("a layer on Pricing the new tier");
  });
});

describe("a both capture leaves the seam on its actions", () => {
  it("stamps threadId with the thread the layer landed on", async () => {
    const { applySorted } = await import("./boardOps");
    const { EMPTY } = await import("./model");
    const out = applySorted(
      { kind: "both", clean: "c", title: "T", actions: ["do the thing"], threadId: null, threadName: "Home", shelfLife: "keep" } as never,
      [],
      1,
      EMPTY
    );
    const action = out.next.actions[0];
    const thread = out.next.threads[0];
    expect(action.threadId).toBe(thread.id);
  });
});

describe("the duplicate banner costs more than a turn of phrase", () => {
  const act = (id: string, text: string) =>
    ({ id, text, done: false, at: 1, imgs: [], shelf: "keep", expires: null }) as Board["actions"][number];

  it("stays quiet on a two-word overlap and speaks on three", async () => {
    const { computeSuggestion } = await import("./boardOps");
    const { EMPTY } = await import("./model");
    const two: Board = {
      ...EMPTY,
      actions: [act("new", "Cancel the newsletter subscription"), act("old", "Cancel the gym subscription")],
    };
    expect(
      computeSuggestion(two, "Cancel the newsletter subscription", {
        kind: "action",
        id: "new",
      })?.kind
    ).not.toBe("duplicate");

    /* Three content words in a row — "gym" is three letters and never
       counts, which is why the pair above only ever shared two. */
    const three: Board = {
      ...EMPTY,
      actions: [
        act("new", "Cancel the newsletter subscription tomorrow"),
        act("old", "Cancel the newsletter subscription"),
      ],
    };
    expect(
      computeSuggestion(three, "Cancel the newsletter subscription tomorrow", {
        kind: "action",
        id: "new",
      })?.kind
    ).toBe("duplicate");
  });
});

describe("computeSuggestion — no home offers, by decision (2026-09-01)", () => {
  it("a shared phrase with an existing thread proposes nothing", () => {
    /* The words below overlap the thread's fragment heavily — the old
       string-matcher fired on far less. First restricted, then judged,
       it kept second-guessing the sorter's filing and never helped:
       "it doesn't help make any decision that improves capture. It just
       matches words." A capture that landed somewhere STAYS there unless
       the person moves it. */
    const board = base({
      threads: [
        thread("bank", "Banking Info", [
          { id: "f1", at: 900, text: "New banking info for the business account arrives Tuesday" },
        ]),
        thread("fresh", "Sorting bug report", [
          { id: "f2", at: 1000, text: "Bug report: a capture mentioning banking info was filed into the wrong thread" },
        ]),
      ],
    });
    expect(
      computeSuggestion(
        board,
        "Bug report: a capture mentioning banking info was filed into the wrong thread",
        { kind: "thread", id: "fresh", fragId: "f2" }
      )
    ).toBe(null);
  });
});

describe("computeSuggestion — a completion note is not a duplicate (2026-09-02)", () => {
  it("saying a thing IS DONE never flags the note that asked for it", () => {
    /* Caught on camera: "the undo button is in and working now" was
       offered as a duplicate of "I want an undo button", because word
       coverage cannot tell doing from done — they share every content
       word. Completion notes are a first-class flow now (looks_done reads
       them); the model's Tidy pass owns real note duplicates instead. */
    const board = base({
      threads: [
        thread("bugs", "Bugs & Open Issues", [
          { id: "f1", at: 900, text: "When I discard an intention draft there is no way back — I want an undo button next to the edit wording button." },
          { id: "f2", at: 1000, text: "The undo button next to the edit wording is in and working now, tested it on the intention screen." },
        ]),
      ],
    });
    expect(
      computeSuggestion(
        board,
        "The undo button next to the edit wording is in and working now, tested it on the intention screen.",
        { kind: "thread", id: "bugs", fragId: "f2" }
      )
    ).toBe(null);
  });
});
