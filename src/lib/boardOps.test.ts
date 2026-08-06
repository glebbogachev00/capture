import { describe, expect, it } from "vitest";
import { applySorted, type SortResult } from "./boardOps";
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
