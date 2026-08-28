import { describe, it, expect } from "vitest";
import { boardSignature, mergeSync } from "./sync";
import type { Board } from "./model";
import type { CaptureEntry } from "./ledger";
import type { DayWrap } from "./wrap";

/**
 * History-only changes must move the signature.
 *
 * The adoption gate compares the merged board's signature against the local
 * one and throws the merge away when they match. History is the part of the
 * board no screen shows, so when the signature ignored it the failure was
 * silent: the pull merged correctly and was then discarded. Everything that
 * can differ between two devices needs a test here.
 */

const base = (): Board => ({
  actions: [], threads: [], intentions: [], principles: [],
  ledger: [], corrections: [], wraps: [], completions: [],
});
const sig = (b: Board) => boardSignature(b, []);
const stats = (day: string): DayWrap["stats"] => ({
  day, said: 3, threadsMoved: 1, actionsMade: 0, intentions: 0,
  threads: [], firstAt: 0, lastAt: 0, returns: [], finished: [],
});
const dayWrap = (day: string, seen?: boolean): DayWrap => ({
  day, at: 1, line: "l", insights: [], tomorrow: "", stats: stats(day), seen,
});
const entry = (id: string, at: number, undone?: boolean): CaptureEntry =>
  ({ id, at, raw: "x", clean: "x", kind: "thread", source: "typed", targetId: "t", undone }) as CaptureEntry;

describe("boardSignature sees history", () => {
  it("moves when a capture is added to the ledger", () => {
    const a = base();
    const b = { ...base(), ledger: [entry("e1", 10)] };
    expect(sig(a)).not.toBe(sig(b));
  });

  it("moves when a capture is undone — the only mutable ledger field", () => {
    const a = { ...base(), ledger: [entry("e1", 10)] };
    const b = { ...base(), ledger: [entry("e1", 10, true)] };
    expect(sig(a)).not.toBe(sig(b));
  });

  it("moves when the ledger is at its cap and the newest entry changes", () => {
    /* Length alone cannot see this: at the cap a new capture pushes the
       oldest out, so the count never moves. */
    const a = { ...base(), ledger: [entry("new1", 20), entry("old", 10)] };
    const b = { ...base(), ledger: [entry("new2", 21), entry("old", 10)] };
    expect(sig(a)).not.toBe(sig(b));
  });

  it("moves when a wrap is written", () => {
    const a = base();
    const b = { ...base(), wraps: [dayWrap("2026-08-27")] };
    expect(sig(a)).not.toBe(sig(b));
  });

  it("moves when a wrap is read on another device", () => {
    const a = { ...base(), wraps: [dayWrap("2026-08-27")] };
    const b = { ...base(), wraps: [dayWrap("2026-08-27", true)] };
    expect(sig(a)).not.toBe(sig(b));
  });

  it("moves when an action is ticked", () => {
    const a = base();
    const b = { ...base(), completions: [{ id: "a1", text: "did it", at: 5 }] };
    expect(sig(a)).not.toBe(sig(b));
  });

  it("moves when a correction is recorded", () => {
    const a = base();
    const b = {
      ...base(),
      corrections: [
        {
          id: "c1", at: 1, proposalKind: "rename_thread" as const,
          accepted: true, context: "",
        },
      ],
    };
    expect(sig(a)).not.toBe(sig(b));
  });

  it("moves when history is reset", () => {
    expect(sig(base())).not.toBe(sig({ ...base(), historyEpoch: 7 }));
  });

  it("stays put when nothing changed", () => {
    const b = { ...base(), ledger: [entry("e1", 10)], completions: [{ id: "a1", text: "t", at: 2 }] };
    expect(sig(b)).toBe(sig({ ...b }));
  });
});

describe("the adoption gate lets history through", () => {
  it("a wrap written on another device survives the pull", () => {
    /* End to end over the real gate: merge, then the same comparison
       useBoard makes before it adopts. */
    const local = { board: base(), tombstones: [] };
    const remote = {
      board: { ...base(), wraps: [dayWrap("2026-08-27")] },
      tombstones: [],
    };
    const merged = mergeSync(local, remote);
    expect(merged.board.wraps).toHaveLength(1);
    const adopted =
      boardSignature(merged.board, merged.tombstones) !==
      boardSignature(local.board, local.tombstones);
    expect(adopted).toBe(true);
  });

  it("a tick on another device survives the pull", () => {
    const local = { board: base(), tombstones: [] };
    const remote = { board: { ...base(), completions: [{ id: "a1", text: "did it", at: 5 }] }, tombstones: [] };
    const merged = mergeSync(local, remote);
    expect(merged.board.completions).toHaveLength(1);
    expect(
      boardSignature(merged.board, merged.tombstones) !== boardSignature(local.board, local.tombstones)
    ).toBe(true);
  });
});
