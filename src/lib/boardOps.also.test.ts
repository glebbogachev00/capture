import { describe, expect, it } from "vitest";
import { applySorted, type SortResult } from "./boardOps";
import type { Board } from "./model";

/**
 * One breath, two subjects. "Retake is slow and Capture keeps mis-sorting"
 * is not one thought filed twice — it is two thoughts said together, and
 * filing the whole sentence in one thread puts half of it where its owner
 * will never look for it.
 */
const board = (): Board => ({
  actions: [],
  threads: [
    { id: "t-retake", name: "Retake", summary: "", frags: [] },
    { id: "t-capture", name: "Capture.", summary: "", frags: [] },
  ],
  intentions: [],
  principles: [],
  ledger: [],
  corrections: [],
});

const base: SortResult = {
  clean: "Retake takes a while to render on this machine.",
  kind: "thread",
  title: "Retake speed",
  threadId: "t-retake",
  threadName: null,
};

describe("a capture that is about two subjects", () => {
  it("puts each part in its own thread, and neither text in both", () => {
    const out: SortResult = {
      ...base,
      primaryText: "Retake takes a while to render on this machine.",
      also: [
        { text: "Capture keeps mis-sorting my notes.", threadId: "t-capture" },
      ],
    };
    const { next, landed } = applySorted(out, [], 1, board());
    const retake = next.threads.find((t) => t.id === "t-retake")!;
    const capture = next.threads.find((t) => t.id === "t-capture")!;

    expect(retake.frags).toHaveLength(1);
    expect(capture.frags).toHaveLength(1);
    expect(retake.frags[0].text).toContain("Retake takes a while");
    expect(capture.frags[0].text).toContain("mis-sorting");
    // split, never copied
    expect(retake.frags[0].text).not.toContain("mis-sorting");
    expect(capture.frags[0].text).not.toContain("Retake takes a while");
    // the banner names both, because "it went somewhere" is the doubt a split creates
    expect(landed).toContain("Capture.");
  });

  it("opens a thread when the second subject has no home yet", () => {
    const out: SortResult = {
      ...base,
      primaryText: "Retake takes a while to render on this machine.",
      also: [{ text: "I want a daily journal.", threadId: null, threadName: "Journal" }],
    };
    const { next } = applySorted(out, [], 1, board());
    const fresh = next.threads.find((t) => t.name === "Journal");
    expect(fresh).toBeTruthy();
    expect(fresh!.frags[0].text).toBe("I want a daily journal.");
    expect(next.threads).toHaveLength(3);
  });

  it("keeps the words when the named thread has since gone", () => {
    const out: SortResult = {
      ...base,
      primaryText: "Retake takes a while to render on this machine.",
      also: [{ text: "orphaned words", threadId: "t-deleted" }],
    };
    const { next } = applySorted(out, [], 1, board());
    expect(
      next.threads.some((t) => t.frags.some((f) => f.text === "orphaned words"))
    ).toBe(true);
  });

  it("changes nothing at all for the ordinary one-subject capture", () => {
    const plain = applySorted(base, [], 1, board());
    const withEmpty = applySorted({ ...base, also: [] }, [], 1, board());
    expect(plain.landed).toBe(withEmpty.landed);
    expect(plain.next.threads).toHaveLength(2);
    expect(withEmpty.next.threads).toHaveLength(2);
  });

  it("everything it created is in landedIds, so Undo takes all of it back", () => {
    const out: SortResult = {
      ...base,
      primaryText: "Retake takes a while to render on this machine.",
      also: [{ text: "second subject", threadId: null, threadName: "New" }],
    };
    const { landedIds, next } = applySorted(out, [], 1, board());
    const fresh = next.threads.find((t) => t.name === "New")!;
    expect(landedIds).toContain(fresh.id);
    expect(landedIds).toContain(fresh.frags[0].id);
  });
});

describe("a split the model did not finish", () => {
  /* `also` without `primaryText` means the model named the second subject but
     never said what stays behind. Applying it anyway filed the whole capture
     in the primary AND a copy of half of it elsewhere, leaving the person to
     spot the duplicate. Refusing the split loses nothing. */
  const half: SortResult = {
    ...base,
    clean: "Retake is slow. Also I want a daily journal.",
    primaryText: null,
    also: [{ text: "I want a daily journal.", threadId: null, threadName: "Journal" }],
  };

  it("files the capture once instead of duplicating half of it", () => {
    const { next } = applySorted(half, [], 1, board());
    const texts = next.threads.flatMap((t) => t.frags.map((f) => f.text));
    expect(texts).toEqual(["Retake is slow. Also I want a daily journal."]);
  });

  it("opens no thread for the half it could not place", () => {
    const before = board();
    const { next } = applySorted(half, [], 1, before);
    expect(next.threads).toHaveLength(before.threads.length);
  });

  it("reports no second destination for the caller to log", () => {
    expect(applySorted(half, [], 1, board()).alsoLanded ?? []).toEqual([]);
  });
});

describe("what the caller must record", () => {
  it("names every destination so each gets its own ledger entry", () => {
    const out: SortResult = {
      ...base,
      primaryText: "Retake takes a while to render on this machine.",
      also: [{ text: "I want a daily journal.", threadId: null, threadName: "Journal" }],
    };
    const { alsoLanded } = applySorted(out, [], 1, board());
    expect(alsoLanded).toHaveLength(1);
    expect(alsoLanded![0].text).toBe("I want a daily journal.");
    expect(alsoLanded![0].threadId).toBeTruthy();
    expect(alsoLanded![0].fragId).toBeTruthy();
  });
});
