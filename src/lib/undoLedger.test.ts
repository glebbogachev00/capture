import { describe, it, expect } from "vitest";
import { markUndone, mergeLedgers } from "./ledger";
import type { CaptureEntry } from "./ledger";

/**
 * Undoing a capture has to take back everything that capture wrote.
 *
 * A split lands in more than one thread and records each destination, since
 * the ledger is what Undo walks back and what the daily wrap counts. Marking
 * only the first entry left the other halves standing as things that still
 * happened: their fragments were gone from the board while the record said
 * they were there.
 */

const entry = (id: string, at: number, over: Partial<CaptureEntry> = {}): CaptureEntry =>
  ({ id, at, raw: "said it", clean: "said it", kind: "thread",
     source: "typed", targetId: "t1", ...over }) as CaptureEntry;

describe("undoing a capture", () => {
  it("marks every entry that capture wrote, not just the first", () => {
    const ledger = [entry("primary", 30), entry("second", 29), entry("older", 10)];
    const after = markUndone(ledger, ["primary", "second"]);
    expect(after.filter((e) => e.undone).map((e) => e.id)).toEqual([
      "primary",
      "second",
    ]);
  });

  it("leaves everything else alone", () => {
    const ledger = [entry("mine", 30), entry("theirs", 20)];
    const after = markUndone(ledger, ["mine"]);
    expect(after.find((e) => e.id === "theirs")!.undone).toBeUndefined();
  });

  it("keeps the entry itself — the record is what was said", () => {
    const after = markUndone([entry("a", 1)], ["a"]);
    expect(after).toHaveLength(1);
    expect(after[0].raw).toBe("said it");
  });

  it("does nothing when the capture wrote no entries", () => {
    const ledger = [entry("a", 1)];
    expect(markUndone(ledger, [])).toBe(ledger);
  });

  it("survives a merge with another device's older copy", () => {
    /* The hub may still hold the pre-undo version. Undone is a fact once
       true, so merging must not quietly bring the capture back. */
    const undone = markUndone([entry("split-a", 30), entry("split-b", 29)], [
      "split-a",
      "split-b",
    ]);
    const stale = [entry("split-a", 30), entry("split-b", 29)];
    const merged = mergeLedgers(stale, undone);
    expect(merged.every((e) => e.undone)).toBe(true);
  });

  it("counts a split capture out of the day once, not by halves", () => {
    /* What the daily wrap reads: with only the first entry marked, an undone
       split still contributed a capture to the day's totals. */
    const ledger = markUndone(
      [entry("split-a", 30), entry("split-b", 29), entry("kept", 10)],
      ["split-a", "split-b"]
    );
    expect(ledger.filter((e) => !e.undone)).toHaveLength(1);
  });
});
