import { describe, expect, it } from "vitest";
import type { CaptureEntry } from "./ledger";
import { busiestDay, heatGrid, monthLabels, recordStats } from "./record";

const DAY = 24 * 60 * 60 * 1000;
/* A fixed local noon keeps day bucketing away from midnight edges. */
const NOON = new Date(2026, 7, 12, 12, 0, 0).getTime();

function entry(at: number, kind: CaptureEntry["kind"], source: CaptureEntry["source"] = "typed"): CaptureEntry {
  return { id: "e" + at + kind, at, raw: "r", clean: "c", kind, source, targetId: "t" };
}

describe("recordStats", () => {
  it("totals by kind, counting 'both' in each place it landed", () => {
    const stats = recordStats([
      entry(100, "action"),
      entry(200, "thread"),
      entry(300, "both"),
      entry(400, "intention"),
      entry(500, "thread", "dictated"),
    ]);
    expect(stats.total).toBe(5);
    expect(stats.since).toBe(100);
    expect(stats.actions).toBe(2);
    expect(stats.threads).toBe(3);
    expect(stats.intentions).toBe(1);
    expect(stats.dictated).toBe(1);
  });

  it("an empty ledger has no since", () => {
    expect(recordStats([])).toEqual({
      total: 0,
      since: null,
      actions: 0,
      threads: 0,
      intentions: 0,
      dictated: 0,
    });
  });
});

describe("heatGrid", () => {
  it("is weeks of seven days, oldest first, ending today", () => {
    const grid = heatGrid([], NOON, 12);
    expect(grid).toHaveLength(12);
    expect(grid.every((w) => w.length === 7)).toBe(true);
    expect(grid.at(-1)?.at(-1)?.day).toBe("2026-08-12");
    expect(grid[0][0].day).toBe("2026-05-21"); /* 83 days back */
  });

  it("buckets captures into their local day with fixed levels", () => {
    const ledger = [
      entry(NOON, "action"),                       /* today: 1 → l1 */
      ...[1, 2, 3].map((i) => entry(NOON - DAY + i, "thread" as const)), /* yesterday: 3 → l2 */
      ...[1, 2, 3, 4, 5].map((i) => entry(NOON - 2 * DAY + i, "action" as const)), /* 5 → l3 */
    ];
    const grid = heatGrid(ledger, NOON, 12);
    const flat = grid.flat();
    expect(flat.at(-1)).toMatchObject({ count: 1, level: 1 });
    expect(flat.at(-2)).toMatchObject({ count: 3, level: 2 });
    expect(flat.at(-3)).toMatchObject({ count: 5, level: 3 });
    expect(flat.at(-4)).toMatchObject({ count: 0, level: 0 });
  });

  it("ignores captures older than the window", () => {
    const grid = heatGrid([entry(NOON - 200 * DAY, "action")], NOON, 12);
    expect(grid.flat().every((c) => c.count === 0)).toBe(true);
  });
});

describe("monthLabels", () => {
  it("names a column only where a new month begins", () => {
    const labels = monthLabels(heatGrid([], NOON, 12));
    /* May 21 → Aug 12 spans four months; every other column is blank. */
    expect(labels.filter(Boolean)).toEqual(["May", "Jun", "Jul", "Aug"]);
    expect(labels[0]).toBe("May");
    expect(labels).toHaveLength(12);
  });
});

describe("busiestDay", () => {
  it("finds the fullest day, or null on an empty grid", () => {
    const ledger = [
      entry(NOON, "action"),
      ...[1, 2, 3].map((i) => entry(NOON - DAY + i, "thread" as const)),
    ];
    const best = busiestDay(heatGrid(ledger, NOON, 12));
    expect(best).toMatchObject({ day: "2026-08-11", count: 3 });
    expect(busiestDay(heatGrid([], NOON, 12))).toBeNull();
  });
});
