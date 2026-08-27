import { describe, expect, it } from "vitest";
import type { Board, Thread } from "./model";
import { arrivedIn, arrivedNote } from "./arrived";

function board(a: { actions?: string[]; threads?: [string, string[]][] }): Board {
  return {
    actions: (a.actions || []).map((id) => ({
      id,
      text: id,
      done: false,
      at: 0,
      shelf: "keep" as const,
      expires: null,
    })),
    threads: (a.threads || []).map(
      ([id, frags]): Thread => ({
        id,
        name: id,
        summary: "",
        frags: frags.map((f) => ({ id: f, at: 0, text: f })),
      })
    ),
    intentions: [],
    principles: [],
    ledger: [],
    corrections: [],
  };
}

describe("arrivedIn", () => {
  it("counts only what the merge added", () => {
    const before = board({ actions: ["a1"], threads: [["t1", ["f1"]]] });
    const after = board({
      actions: ["a1", "a2"],
      threads: [
        ["t1", ["f1", "f2"]],
        ["t2", ["f3"]],
      ],
    });
    expect(arrivedIn(before, after)).toEqual({
      actions: 1,
      frags: 2, // f2 into t1, f3 inside the new thread
      threads: 1,
    });
  });

  it("an unchanged board brings nothing", () => {
    const b = board({ actions: ["a1"], threads: [["t1", ["f1"]]] });
    expect(arrivedIn(b, b)).toEqual({ actions: 0, frags: 0, threads: 0 });
  });

  it("deletions never read as arrivals", () => {
    const before = board({ actions: ["a1", "a2"] });
    const after = board({ actions: ["a1"] });
    expect(arrivedIn(before, after)).toEqual({
      actions: 0,
      frags: 0,
      threads: 0,
    });
  });
});

describe("arrivedNote", () => {
  it("says nothing when nothing arrived", () => {
    expect(arrivedNote({ actions: 0, frags: 0, threads: 0 })).toBeNull();
  });

  it("names fragments on their own", () => {
    expect(arrivedNote({ actions: 0, frags: 2, threads: 0 })).toBe(
      "2 fragments arrived from your other device."
    );
  });

  it("singular reads naturally", () => {
    expect(arrivedNote({ actions: 1, frags: 0, threads: 0 })).toBe(
      "1 action arrived from your other device."
    );
  });

  it("a new thread speaks for the fragments inside it", () => {
    expect(arrivedNote({ actions: 0, frags: 3, threads: 1 })).toBe(
      "1 thread arrived from your other device."
    );
  });

  it("joins two kinds with and", () => {
    expect(arrivedNote({ actions: 2, frags: 1, threads: 0 })).toBe(
      "2 actions and 1 fragment arrived from your other device."
    );
  });
});
