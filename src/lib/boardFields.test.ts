import { describe, it, expect } from "vitest";
import { hydrate, type Board } from "./model";
import { mergeBoards, applyTombstones } from "./sync";
import { buildBackup, restoreBackup } from "./backup";
import type { DayWrap } from "./wrap";

/**
 * No field left behind.
 *
 * Four separate places rebuild a Board by naming its fields one at a time:
 * `hydrate`, the sync merge, backup restore, and Undo. Every one of them
 * drops anything it was not told about, and the loss is always silent —
 * there is no error, the data is simply gone the next time you look.
 *
 * `wraps` and `completions` were added in one place and missed in two of the
 * other three. This test exists so the next field cannot repeat that: it
 * reflects over the keys of a fully-populated board, so a field added to the
 * type without being added to these paths fails here rather than in someone's
 * board a week later.
 *
 * Undo is not a pure function and cannot be called from here; it is covered
 * separately in undoLedger.test.ts. If you add a field, add it there too.
 */

const wrap: DayWrap = {
  day: "2026-08-26",
  at: 10,
  line: "the day",
  insights: [{ k: "weight", v: "v" }],
  tomorrow: "t",
  stats: {
    day: "2026-08-26", said: 4, threadsMoved: 1, actionsMade: 1, intentions: 0,
    threads: [{ name: "Bugs", n: 2 }], firstAt: 1, lastAt: 9, returns: [], finished: [],
  },
};

/** A board with something in every field, so an emptied one is detectable. */
function fullBoard(): Board {
  return {
    actions: [{ id: "a1", text: "do it", done: false, at: 5, shelf: "keep", expires: null }],
    threads: [{ id: "t1", name: "Bugs", summary: "s", frags: [{ id: "f1", at: 5, text: "x" }] }],
    intentions: [{ id: "i1", number: 1, rawInput: "r", expandedIntention: "e",
                  recommendedActions: [], counterIntentions: [], at: 5, updatedAt: 5 }],
    principles: [{ id: "p1", name: "Simplify", description: "Remove before adding.",
                   enabled: true, updatedAt: 5 }],
    ledger: [{ id: "l1", at: 5, raw: "r", clean: "c", kind: "thread",
               source: "typed", targetId: "t1" }],
    corrections: [{ id: "c1", at: 5, proposalKind: "rename_thread",
                    accepted: true, context: "" }],
    wraps: [wrap],
    completions: [{ id: "a9", text: "did it", at: 6 }],
    historyEpoch: 7,
  } as Board;
}

/** Every key of a full board, so the check cannot miss one by omission. */
const FIELDS = Object.keys(fullBoard()) as (keyof Board)[];

function assertNothingLost(label: string, out: Board) {
  for (const key of FIELDS) {
    const value = out[key];
    expect(value, `${label} dropped "${key}"`).toBeDefined();
    if (Array.isArray(value)) {
      expect(value.length, `${label} emptied "${key}"`).toBeGreaterThan(0);
    }
  }
  expect(out.historyEpoch, `${label} lost historyEpoch`).toBe(7);
}

describe("every Board field survives", () => {
  it("hydrate — the hub round trip", () => {
    assertNothingLost("hydrate", hydrate(fullBoard()));
  });

  it("the sync merge, from either side", () => {
    assertNothingLost("mergeBoards(full, empty)", mergeBoards(fullBoard(), hydrate(null)));
    assertNothingLost("mergeBoards(empty, full)", mergeBoards(hydrate(null), fullBoard()));
  });

  it("applying tombstones", () => {
    assertNothingLost("applyTombstones", applyTombstones(fullBoard(), []));
  });

  it("a backup export and restore", () => {
    const { board } = restoreBackup(buildBackup(fullBoard()), hydrate(null));
    assertNothingLost("restoreBackup", board);
  });

  it("a full round trip through all of them", () => {
    const stored = hydrate(fullBoard());
    const pulled = mergeBoards(stored, hydrate(JSON.parse(JSON.stringify(stored))));
    const { board } = restoreBackup(buildBackup(pulled), hydrate(null));
    assertNothingLost("full round trip", hydrate(board));
  });
});
