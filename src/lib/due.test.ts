import { describe, expect, it } from "vitest";
import { DAY, fmtDue } from "./model";
import { AFTER_DUE, expiryFor, parseDue } from "./due";

const NOW = new Date(2026, 7, 14, 12, 0, 0).getTime();

describe("parseDue", () => {
  it("reads a date the model returned", () => {
    const t = parseDue("2026-08-28T17:00:00", NOW);
    expect(t).toBe(new Date(2026, 7, 28, 17, 0, 0).getTime());
  });

  it("accepts a plain date with no time", () => {
    expect(parseDue("2026-08-20", NOW)).toBeGreaterThan(NOW);
  });

  it("returns null when there is no date at all", () => {
    for (const bad of [null, undefined, "", "friday", "soon", "not a date"]) {
      expect(parseDue(bad, NOW), String(bad)).toBeNull();
    }
  });

  it("refuses a date long past — that capture is history, not a deadline", () => {
    expect(parseDue("2025-01-01", NOW)).toBeNull();
  });

  it("tolerates today and yesterday, which are still actionable", () => {
    expect(parseDue(new Date(NOW).toISOString(), NOW)).not.toBeNull();
    expect(parseDue(new Date(NOW - DAY / 2).toISOString(), NOW)).not.toBeNull();
  });

  it("refuses a hallucinated century", () => {
    expect(parseDue("3025-01-01", NOW)).toBeNull();
  });
});

describe("expiryFor", () => {
  it("keeps ordinary shelf life when nothing was dated", () => {
    expect(expiryFor(7 * DAY, null, NOW)).toBe(NOW + 7 * DAY);
  });

  it("never fades before a stated deadline — the whole point", () => {
    /* Said on the 14th, due the 28th, judged as an ordinary week's errand:
       the old behaviour faded it a week early. */
    const due = NOW + 14 * DAY;
    expect(expiryFor(7 * DAY, due, NOW)).toBe(due + AFTER_DUE);
  });

  it("leaves a generous shelf life alone when the deadline is sooner", () => {
    const due = NOW + 2 * DAY;
    expect(expiryFor(30 * DAY, due, NOW)).toBe(NOW + 30 * DAY);
  });

  it("outlives its deadline by a day, so a thing due today survives tonight", () => {
    const due = NOW + 60 * 60 * 1000;
    expect(expiryFor(DAY, due, NOW)).toBe(due + AFTER_DUE);
  });

  it("keep still means keep, dated or not", () => {
    expect(expiryFor(null, NOW + 5 * DAY, NOW)).toBeNull();
    expect(expiryFor(null, null, NOW)).toBeNull();
  });
});

describe("a bare date is a day, not an instant", () => {
  it("lands on the named day in local time, not the evening before", () => {
    const t = parseDue("2026-09-28", NOW)!;
    const d = new Date(t);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(8); // September
    expect(d.getDate()).toBe(28); // not the 27th, whatever the timezone
  });

  it("is due by the end of that day, not the start of it", () => {
    const d = new Date(parseDue("2026-09-28", NOW)!);
    expect(d.getHours()).toBe(23);
    expect(d.getMinutes()).toBe(59);
  });

  it("still honours an explicit time when one was actually said", () => {
    const d = new Date(parseDue("2026-08-21T17:00:00", NOW)!);
    expect(d.getHours()).toBe(17);
  });
});

describe("fmtDue", () => {
  it("shows the day and never a model-derived clock time", () => {
    const withTime = new Date(2026, 8, 28, 5, 0, 0).getTime();
    const endOfDay = new Date(2026, 8, 28, 23, 59, 0).getTime();
    expect(fmtDue(withTime)).toBe(fmtDue(endOfDay));
    expect(fmtDue(withTime)).not.toMatch(/\d:\d\d/);
  });
});
