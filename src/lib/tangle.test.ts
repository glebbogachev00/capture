import { describe, it, expect } from "vitest";
import { confusedPairs, tangleReason, MIN_CONFUSIONS } from "./tangle";
import type { Board } from "./model";
import type { CaptureEntry } from "./ledger";

/**
 * The pair a person keeps correcting between is the one worth asking about.
 * It is read off history that already exists: where the engine filed each
 * capture, against where its fragment lives today.
 */

const entry = (id: string, filedIn: string, fragId: string, at = 1): CaptureEntry =>
  ({ id, at, raw: "r", clean: "c", kind: "thread", source: "typed",
     targetId: filedIn, targetFragId: fragId }) as CaptureEntry;

function board(
  threads: { id: string; name: string; fragIds: string[] }[],
  ledger: CaptureEntry[]
): Board {
  return {
    actions: [], intentions: [], principles: [], corrections: [], ledger,
    threads: threads.map((t) => ({
      id: t.id, name: t.name, summary: "",
      frags: t.fragIds.map((id) => ({ id, at: 1, text: "x" })),
    })),
  } as Board;
}

/** Three captures the engine put in A that now live in B. */
const leaky = () =>
  board(
    [
      { id: "a", name: "Capture.", fragIds: [] },
      { id: "b", name: "Bugs", fragIds: ["f1", "f2", "f3"] },
    ],
    [entry("l1", "a", "f1"), entry("l2", "a", "f2"), entry("l3", "a", "f3")]
  );

describe("threads that keep being confused", () => {
  it("finds the pair, and which way it leaks", () => {
    const [pair] = confusedPairs(leaky());
    expect(pair.fromName).toBe("Capture.");
    expect(pair.toName).toBe("Bugs");
    expect(pair.times).toBe(3);
  });

  it("says nothing about a one-off correction", () => {
    const b = board(
      [
        { id: "a", name: "Capture.", fragIds: [] },
        { id: "b", name: "Bugs", fragIds: ["f1"] },
      ],
      [entry("l1", "a", "f1")]
    );
    expect(confusedPairs(b)).toEqual([]);
  });

  it("counts the two directions apart", () => {
    /* "What you file as A belongs in B" is a different observation from its
       reverse, and a pair usually leaks mostly one way. */
    const b = board(
      [
        { id: "a", name: "Capture.", fragIds: ["g1"] },
        { id: "b", name: "Bugs", fragIds: ["f1", "f2", "f3"] },
      ],
      [
        entry("l1", "a", "f1"), entry("l2", "a", "f2"), entry("l3", "a", "f3"),
        entry("l4", "b", "g1"),
      ]
    );
    const pairs = confusedPairs(b, 1);
    expect(pairs[0]).toMatchObject({ fromName: "Capture.", toName: "Bugs", times: 3 });
    expect(pairs[1]).toMatchObject({ fromName: "Bugs", toName: "Capture.", times: 1 });
  });

  it("ignores captures that stayed where they were put", () => {
    const b = board(
      [{ id: "a", name: "Capture.", fragIds: ["f1", "f2", "f3"] }],
      [entry("l1", "a", "f1"), entry("l2", "a", "f2"), entry("l3", "a", "f3")]
    );
    expect(confusedPairs(b, 1)).toEqual([]);
  });

  it("ignores a fragment that has since been deleted", () => {
    /* Gone says nothing about where it belonged. */
    const b = board(
      [{ id: "a", name: "Capture.", fragIds: [] }],
      [entry("l1", "a", "missing"), entry("l2", "a", "gone"), entry("l3", "a", "also")]
    );
    expect(confusedPairs(b, 1)).toEqual([]);
  });

  it("ignores an undone capture", () => {
    const b = leaky();
    b.ledger = b.ledger.map((e) => ({ ...e, undone: true }));
    expect(confusedPairs(b, 1)).toEqual([]);
  });

  it("drops a pair whose thread has since gone", () => {
    const b = leaky();
    b.threads = b.threads.filter((t) => t.id !== "a");
    expect(confusedPairs(b, 1)).toEqual([]);
  });

  it("puts the worst pair first", () => {
    const b = board(
      [
        { id: "a", name: "A", fragIds: [] },
        { id: "b", name: "B", fragIds: ["f1", "f2"] },
        { id: "c", name: "C", fragIds: ["g1", "g2", "g3", "g4"] },
      ],
      [
        entry("1", "a", "f1"), entry("2", "a", "f2"),
        entry("3", "a", "g1"), entry("4", "a", "g2"),
        entry("5", "a", "g3"), entry("6", "a", "g4"),
      ]
    );
    expect(confusedPairs(b, 1).map((p) => p.toName)).toEqual(["C", "B"]);
  });

  it("needs a real pattern before it speaks", () => {
    expect(MIN_CONFUSIONS).toBeGreaterThan(1);
  });
});

describe("how it reads", () => {
  it("states the count and both threads, and nothing else", () => {
    const [pair] = confusedPairs(leaky());
    expect(tangleReason(pair)).toBe("you have moved 3 things from Capture. to Bugs");
  });

  it("counts one thing as one thing", () => {
    const b = board(
      [
        { id: "a", name: "A", fragIds: [] },
        { id: "b", name: "B", fragIds: ["f1"] },
      ],
      [entry("l1", "a", "f1")]
    );
    expect(tangleReason(confusedPairs(b, 1)[0])).toContain("1 thing from");
  });
});
