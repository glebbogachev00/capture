import { describe, expect, it } from "vitest";
import { EMPTY } from "./model";
import type { TangleProposal } from "./tangle";
import { applyTangleAccept } from "./tangleOps";

/**
 * Behavior tests for the merge math — replacing the source-grep guards that
 * could only check the code's shape, never its answers. Both of this
 * feature's shipped bugs (the mislabelled merge, the unreachable merge)
 * would have failed here as assertions instead of being found in a
 * recording.
 */

const frag = (id: string, text: string, at: number) => ({ id, text, at });

const board = () =>
  ({
    ...EMPTY,
    threads: [
      {
        id: "from",
        name: "Capture.",
        at: 1,
        frags: [
          frag("f1", "the sorter keeps misfiling notes", 10),
          frag("f2", "tidy loads slowly on the phone", 20),
          frag("f3", "covers disappear during sorting", 30),
        ],
      },
      {
        id: "to",
        name: "Bugs & Open Issues",
        at: 1,
        frags: [frag("f9", "the banner vanishes too fast", 15)],
      },
    ],
    actions: [
      { id: "a1", text: "fix the sorter", done: false, at: 5, threadId: "from" },
      { id: "a2", text: "unrelated errand", done: false, at: 6 },
    ],
  }) as never;

const proposal: TangleProposal = {
  pair: {
    fromId: "from",
    fromName: "Capture.",
    toId: "to",
    toName: "Bugs & Open Issues",
    times: 7,
    lastAt: 0,
  },
  move: [
    { id: "f1", why: "" },
    { id: "f2", why: "" },
  ],
  rename: null,
  fromFrags: 3,
};

describe("accepting an untangle", () => {
  it("moves the chosen notes, in time order, and leaves the thread standing", () => {
    const out = applyTangleAccept(board(), proposal, ["f1"], false)!;
    expect(out.emptied).toBe(false);
    expect(out.moved).toBe(1);
    const from = out.board.threads.find((t) => t.id === "from")!;
    const to = out.board.threads.find((t) => t.id === "to")!;
    expect(from.frags.map((f) => f.id)).toEqual(["f2", "f3"]);
    /* Time order in the destination — f1 (at 10) lands before f9 (at 15). */
    expect(to.frags.map((f) => f.id)).toEqual(["f1", "f9"]);
    expect(out.notice).toBe("Moved 1 to Bugs & Open Issues");
  });

  it("absorbs the thread only when every note actually leaves it", () => {
    /* The mislabelled-merge bug: the UI counted the PROPOSED rows, the
       board counted the thread's rows, and "Merge" moved 22 while 19
       threads stayed 19. This is the assertion that was missing. */
    const partial = applyTangleAccept(board(), proposal, ["f1", "f2"], false)!;
    expect(partial.emptied).toBe(false);
    expect(partial.board.threads.map((t) => t.id)).toContain("from");

    const all = applyTangleAccept(board(), proposal, ["f1", "f2", "f3"], false)!;
    expect(all.emptied).toBe(true);
    expect(all.board.threads.map((t) => t.id)).not.toContain("from");
    expect(all.notice).toBe("Merged Capture. into Bugs & Open Issues · 3 notes");
  });

  it("takeAll reaches past the judge's list to the whole thread", () => {
    /* The unreachable-merge bug: the judge lists its confident subset, so
       ticking everything emptied the review, never the thread. */
    const out = applyTangleAccept(board(), proposal, [], false, true)!;
    expect(out.emptied).toBe(true);
    expect(out.moved).toBe(3);
  });

  it("actions follow an absorbed thread instead of pointing at nothing", () => {
    const out = applyTangleAccept(board(), proposal, [], false, true)!;
    const a1 = out.board.actions.find((a) => a.id === "a1")!;
    const a2 = out.board.actions.find((a) => a.id === "a2")!;
    expect(a1.threadId).toBe("to");
    expect(a2.threadId).toBeUndefined();
  });

  it("never absorbs a thread that was already empty", () => {
    const b = board() as { threads: { id: string; frags: unknown[] }[] };
    b.threads.find((t) => t.id === "from")!.frags = [];
    const out = applyTangleAccept(
      b as never,
      { ...proposal, rename: "Bugs", fromFrags: 0 },
      [],
      true
    )!;
    expect(out.emptied).toBe(false);
    expect(out.board.threads.map((t) => t.id)).toContain("from");
  });

  it("renames only when the rename was accepted", () => {
    const p = { ...proposal, rename: "Bugs" };
    const kept = applyTangleAccept(board(), p, ["f1"], false)!;
    expect(kept.board.threads.find((t) => t.id === "from")!.name).toBe("Capture.");
    const renamed = applyTangleAccept(board(), p, ["f1"], true)!;
    expect(renamed.board.threads.find((t) => t.id === "from")!.name).toBe("Bugs");
    expect(renamed.notice).toBe("Moved 1 to Bugs & Open Issues · renamed to Bugs");
  });

  it("nothing chosen and no rename is a no-op, not an accident", () => {
    expect(applyTangleAccept(board(), proposal, [], false)).toBeNull();
  });
});
