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
