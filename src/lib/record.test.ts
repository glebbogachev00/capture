import { describe, expect, it } from "vitest";
import type { CaptureEntry } from "./ledger";
import { caughtWords, dayCaptures, dayKey, heatGrid, monthLabels, recentCaptures, recordStats } from "./record";

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

  it("does not count a capture that is still waiting to sort", () => {
    expect(recordStats([
      entry(100, "pending"),
      entry(200, "thread"),
    ])).toEqual({
      total: 1,
      since: 200,
      actions: 0,
      threads: 1,
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


describe("recentCaptures", () => {
  const e = (over: Partial<CaptureEntry>): CaptureEntry => ({
    id: "e1", at: 100, raw: "r", clean: "c", kind: "action",
    source: "typed", targetId: "t", ...over,
  });

  it("prefers the recogniser's own words over the box text", () => {
    const [row] = recentCaptures([
      e({ raw: "call the vet tomorrow.", transcript: "uh call the vet tomorrow", clean: "Call the vet tomorrow." }),
    ]);
    expect(row.said).toBe("uh call the vet tomorrow");
    expect(row.filed).toBe("Call the vet tomorrow.");
    expect(row.differs).toBe(true);
  });

  it("falls back to the raw box text when nothing was dictated", () => {
    const [row] = recentCaptures([e({ raw: "buy milk", clean: "Buy milk." })]);
    expect(row.said).toBe("buy milk");
  });

  it("does not call casing or trailing punctuation a change", () => {
    const [row] = recentCaptures([e({ raw: "buy milk", clean: "Buy milk." })]);
    expect(row.differs).toBe(false);
  });

  it("newest first, capped", () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      e({ id: "e" + i, at: i * 100 })
    );
    const rows = recentCaptures(many, 5);
    expect(rows).toHaveLength(5);
    expect(rows[0].at).toBe(1900);
    expect(rows.map((r) => r.at)).toEqual([1900, 1800, 1700, 1600, 1500]);
  });

  it("is empty on an empty ledger", () => {
    expect(recentCaptures([])).toEqual([]);
  });

  it("keeps waiting captures out of the visible record", () => {
    expect(recentCaptures([
      e({ kind: "pending", raw: "private draft" }),
    ])).toEqual([]);
  });
});


describe("caughtWords — the one line under the grid", () => {
  const said = (text: string, at = 1000): CaptureEntry => ({
    id: "c" + at + text.length,
    at,
    raw: text,
    clean: text,
    kind: "action",
    source: "typed",
    targetId: "t",
  });

  it("stays quiet below the first rung", () => {
    /* "Seven words, about a postcard" is a joke at nobody. */
    expect(caughtWords([said("out of cold brew again")])).toBeNull();
  });

  it("counts what was said, not what the engine made of it", () => {
    const many = Array.from({ length: 60 }, (_, i) =>
      said("this is a capture of exactly eight words here", i)
    );
    const out = caughtWords(many)!;
    expect(out.words).toBeGreaterThanOrEqual(480);
    expect(out.like).toBe("an email nobody asked for");
  });

  it("rounds — a comparison, not a measurement", () => {
    const many = Array.from({ length: 500 }, (_, i) => said("one two three four five six", i));
    const out = caughtWords(many)!;
    expect(out.words % 100).toBe(0);
  });

  it("keeps climbing past the last rung", () => {
    const huge = Array.from({ length: 400 }, (_, i) => said("word ".repeat(200), i));
    expect(caughtWords(huge)!.like).toBe("a novel");
  });

  it("does not count words that are still waiting to sort", () => {
    const pending = said("word ".repeat(200));
    pending.kind = "pending";
    expect(caughtWords([pending])).toBeNull();
  });
});

describe("an undone capture in the record", () => {
  it("is counted out and marked", async () => {
    const { recordStats, recentCaptures } = await import("./record");
    const e = (id: string, undone?: boolean) =>
      ({ id, at: 1, raw: "r", clean: "c", kind: "action", source: "typed", targetId: "", undone }) as import("./ledger").CaptureEntry;
    expect(recordStats([e("a"), e("b", true)]).actions).toBe(1);
    expect(recentCaptures([e("b", true)])[0].undone).toBe(true);
  });
});

describe("the record shows a day's story, not the whole history", () => {
  const at = (day: string, h: number) =>
    new Date(day + "T00:00:00").getTime() + h * 3_600_000;
  const entry = (id: string, t: number, raw: string): CaptureEntry => ({
    id,
    at: t,
    raw,
    clean: raw,
    kind: "action",
    source: "typed",
    targetId: id + "-t",
  });
  const ledger = [
    entry("b", at("2026-08-30", 17), "fix the banner so layers turn into action"),
    entry("a", at("2026-08-30", 9), "prepare all materials before the one-to-one class"),
    entry("c", at("2026-08-31", 11), "use retake to record the walkthrough"),
  ];

  it("only the given day's captures, in the order the day was lived", () => {
    const day = dayCaptures(ledger, "2026-08-30");
    expect(day.map((e) => e.id)).toEqual(["a", "b"]); // oldest first
  });

  it("a day with nothing said is an empty story, not someone else's", () => {
    expect(dayCaptures(ledger, "2026-08-29")).toEqual([]);
  });

  it("does not show waiting captures in the day's story", () => {
    expect(dayCaptures([
      { ...entry("waiting", at("2026-08-30", 8), "private draft"), kind: "pending" },
    ], "2026-08-30")).toEqual([]);
  });
});

describe("capture identity across split and corrected filings", () => {
  const words = Array.from({ length: 130 }, () => "word").join(" ");
  const row = (over: Partial<CaptureEntry> & Pick<CaptureEntry, "id" | "kind">): CaptureEntry => ({
    at: NOON,
    raw: words,
    clean: words,
    source: "dictated",
    targetId: "primary-thread",
    captureId: "one-capture",
    ...over,
  });

  it("counts and tells a split capture once while keeping the explicit primary destination", () => {
    const primary = row({ id: "primary", kind: "both", primary: true });
    const secondary = row({
      id: "secondary",
      kind: "thread",
      primary: false,
      targetId: "secondary-thread",
      clean: "secondary share",
    });
    const ledger = [secondary, primary];

    expect(recordStats(ledger)).toMatchObject({
      total: 1, actions: 1, threads: 1, dictated: 1,
    });
    expect(recentCaptures(ledger).map((entry) => entry.id)).toEqual(["primary"]);
    const [story] = dayCaptures(ledger, dayKey(NOON));
    expect(story.targetId).toBe("primary-thread");
    expect(story.destinations).toEqual([
      expect.objectContaining({ entryId: "primary", targetId: "primary-thread", kind: "both" }),
      expect.objectContaining({ entryId: "secondary", targetId: "secondary-thread", kind: "thread", filed: "secondary share" }),
    ]);
    expect(heatGrid(ledger, NOON, 1).flat().at(-1)?.count).toBe(1);
    expect(caughtWords(ledger)?.words).toBe(130);
  });

  it("uses the current explicit primary after a corrected re-sort instead of the undone filing", () => {
    const original = row({ id: "original", kind: "action", primary: true, undone: true });
    const corrected = row({
      id: "corrected",
      kind: "thread",
      primary: true,
      targetId: "correct-thread",
    });
    const secondary = row({
      id: "corrected-secondary",
      kind: "thread",
      primary: false,
      targetId: "secondary-thread",
    });
    const ledger = [corrected, secondary, original];

    expect(recordStats(ledger)).toMatchObject({ total: 1, actions: 0, threads: 1 });
    expect(recentCaptures(ledger).map((entry) => entry.id)).toEqual(["corrected"]);
    const [story] = dayCaptures(ledger, dayKey(NOON));
    expect(story.targetId).toBe("correct-thread");
    expect(story.destinations.map((destination) => destination.targetId))
      .toEqual(["correct-thread", "secondary-thread"]);
    expect(story.destinations.some((destination) => destination.entryId === "original")).toBe(false);
    expect(heatGrid(ledger, NOON, 1).flat().at(-1)?.count).toBe(1);
    expect(caughtWords(ledger)?.words).toBe(130);
  });
});
