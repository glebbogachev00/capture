import { describe, it, expect } from "vitest";
import { planTidy, keepProposals, threadFingerprint } from "./tidyChanged";
import type { Board, Thread } from "./model";

/**
 * Tidy reads the whole board in paced passes and takes three to five
 * minutes, because 15,000 tokens against a per-minute allowance of 8,000 is
 * a two-minute floor before the model thinks at all. The only way to make it
 * quicker is to ask about less — and almost always, nearly everything is
 * unchanged since the last reading.
 */

const thread = (id: string, name: string, frags: string[] = []): Thread =>
  ({
    id,
    name,
    summary: "",
    frags: frags.map((text, i) => ({ id: `${id}f${i}`, at: i + 1, text })),
  }) as Thread;

const board = (threads: Thread[], actions: string[] = []): Board =>
  ({
    threads,
    actions: actions.map((text, i) => ({
      id: `a${i}`, text, done: false, at: 1, shelf: "keep", expires: null,
    })),
    intentions: [], principles: [], ledger: [], corrections: [],
  }) as Board;

const plan = (b: Board, last: Parameters<typeof planTidy>[1]) => planTidy(b, last);

describe("what Tidy still needs to read", () => {
  it("reads everything the first time — there is no way around that", () => {
    const b = board([thread("t1", "A", ["x"]), thread("t2", "B", ["y"])]);
    const p = plan(b, null);
    expect(p.send).toHaveLength(2);
    expect(p.reuseEverything).toBe(false);
  });

  it("reads nothing when nothing moved", () => {
    const b = board([thread("t1", "A", ["x"]), thread("t2", "B", ["y"])]);
    const p = plan(b, plan(b, null).read);
    expect(p.send).toHaveLength(0);
    expect(p.reuseEverything).toBe(true);
  });

  it("reads only the thread that gained a note", () => {
    /* The whole point: one capture should not cost a re-reading of
       eighteen untouched threads. */
    const before = board([thread("t1", "A", ["x"]), thread("t2", "B", ["y"])]);
    const after = board([thread("t1", "A", ["x", "new"]), thread("t2", "B", ["y"])]);
    const p = plan(after, plan(before, null).read);
    expect(p.send.map((t) => t.id)).toEqual(["t1"]);
    expect(p.unchanged.has("t2")).toBe(true);
  });

  it("notices a rename, not just new notes", () => {
    const before = board([thread("t1", "Bugs, Issues and Additions", ["x"])]);
    const after = board([thread("t1", "Bugs", ["x"])]);
    expect(plan(after, plan(before, null).read).send.map((t) => t.id)).toEqual(["t1"]);
  });

  it("notices an edited note, not only an added one", () => {
    const before = board([thread("t1", "A", ["short"])]);
    const after = board([thread("t1", "A", ["much longer than before"])]);
    expect(plan(after, plan(before, null).read).send).toHaveLength(1);
  });

  it("sends a brand new thread", () => {
    const before = board([thread("t1", "A", ["x"])]);
    const after = board([thread("t1", "A", ["x"]), thread("t2", "B", ["y"])]);
    expect(plan(after, plan(before, null).read).send.map((t) => t.id)).toEqual(["t2"]);
  });

  it("re-reads everything when the actions moved", () => {
    /* An action can be folded into any thread or extracted from one, so a
       change among them can invalidate a claim about a thread that did not
       itself change. Rare, so the honest answer is affordable. */
    const before = board([thread("t1", "A", ["x"])], ["do this"]);
    const after = board([thread("t1", "A", ["x"])], ["do this", "and this"]);
    const p = plan(after, plan(before, null).read);
    expect(p.send).toHaveLength(1);
    expect(p.reuseEverything).toBe(false);
    expect(p.unchanged.size).toBe(0);
  });

  it("treats a ticked action as a change", () => {
    const before = board([thread("t1", "A", ["x"])], ["do this"]);
    const after = board([thread("t1", "A", ["x"])]);
    expect(plan(after, plan(before, null).read).reuseEverything).toBe(false);
  });

  it("fingerprints by content, so the same board reads the same twice", () => {
    const a = thread("t1", "A", ["x", "y"]);
    const b = thread("t1", "A", ["x", "y"]);
    expect(threadFingerprint(a)).toBe(threadFingerprint(b));
  });
});

describe("which remembered proposals survive", () => {
  const all = new Set(["t1", "t2"]);

  it("keeps a claim about a thread that was left alone", () => {
    const kept = keepProposals(
      [{ sourceThreadId: "t2", targetId: "t2" }],
      new Set(["t2"]),
      all
    );
    expect(kept).toHaveLength(1);
  });

  it("drops a claim about a thread that was re-read", () => {
    /* The fresh reading replaces it; showing both would mean showing a
       claim about a note that may no longer be there. */
    const kept = keepProposals(
      [{ sourceThreadId: "t1", targetId: "t1" }],
      new Set(["t2"]),
      all
    );
    expect(kept).toHaveLength(0);
  });

  it("drops a claim with a foot in each camp", () => {
    const kept = keepProposals(
      [{ sourceThreadId: "t2", targetId: "t1" }],
      new Set(["t2"]),
      all
    );
    expect(kept).toHaveLength(0);
  });

  it("drops a claim naming a thread that no longer exists", () => {
    const kept = keepProposals(
      [{ sourceThreadId: "gone", targetId: "t2" }],
      new Set(["t2"]),
      all
    );
    expect(kept).toHaveLength(1);
  });

  it("ignores ids that are actions rather than threads", () => {
    /* An action id is not a thread, and actions are re-read wholesale, so
       its presence is not a reason to drop the claim. */
    const kept = keepProposals(
      [{ sourceThreadId: "t2", sourceId: "a7", targetId: "t2" }],
      new Set(["t2"]),
      all
    );
    expect(kept).toHaveLength(1);
  });
});
