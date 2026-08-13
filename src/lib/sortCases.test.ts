import { describe, expect, it } from "vitest";
import cases from "./sortCases.json";

/**
 * Offline guard for the sort case suite.
 *
 * The cases themselves are judged live by scripts/probe-sort-cases.mjs
 * against the real chain — a unit test cannot judge a model. What it CAN
 * do is keep the suite honest: a typo'd kind or a malformed expectation
 * would make a probe check pass vacuously, which reads as "the engine is
 * fine" when nothing was tested at all.
 */

const KINDS = new Set(["action", "thread", "intention", "both"]);
const SHELVES = new Set(["hours", "days", "weeks", "keep"]);

describe("sortCases.json", () => {
  it("ids are unique and every case says why it exists", () => {
    const ids = cases.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of cases) {
      expect(c.why?.length, c.id).toBeGreaterThan(10);
      expect(c.raw?.length, c.id).toBeGreaterThan(10);
    }
  });

  it("every expectation is well-formed", () => {
    for (const c of cases) {
      const e = c.expect as Record<string, unknown>;
      expect(Array.isArray(e.kindOneOf), c.id).toBe(true);
      for (const k of e.kindOneOf as string[]) expect(KINDS.has(k), c.id).toBe(true);
      if (e.actionsBetween) {
        const [lo, hi] = e.actionsBetween as number[];
        expect(lo, c.id).toBeLessThanOrEqual(hi);
        expect(lo, c.id).toBeGreaterThanOrEqual(0);
      }
      if (e.shelfIn)
        for (const s of e.shelfIn as string[])
          expect(SHELVES.has(s), c.id).toBe(true);
      if (e.routeTo)
        expect(
          c.threads.some((t) => t.id === e.routeTo),
          c.id
        ).toBe(true);
      /* noActions and actionsBetween are contradictory — one or the other. */
      if (e.noActions) expect(e.actionsBetween, c.id).toBeUndefined();
      /* Shaping thresholds are counts the probe compares against. */
      for (const key of ["cleanParagraphs", "cleanBullets"] as const) {
        if (e[key] !== undefined) {
          expect(typeof e[key], c.id).toBe("number");
          expect(e[key] as number, c.id).toBeGreaterThan(0);
        }
      }
    }
  });

  it("routing cases carry the thread context they route into", () => {
    for (const c of cases) {
      if ((c.expect as Record<string, unknown>).newThread)
        expect(c.threads.length, c.id).toBeGreaterThan(0);
    }
  });
});
