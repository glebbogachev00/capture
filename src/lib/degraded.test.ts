import { describe, it, expect } from "vitest";
import { degradedTier, degradedNote, BEST_TIER, WINDOW } from "./degraded";

/**
 * The chain falls through silently, and that silence was the bug: a
 * per-minute token ceiling meant a weaker model answered, with nothing on
 * screen to say so, and the app appeared to get worse at random for weeks.
 *
 * The bar for speaking up is deliberately high. One fallback is normal and
 * costs nothing; a run of them means the ceiling has been reached.
 */

const on = (via: string, n: number) =>
  Array.from({ length: n }, (_, i) => ({ via, at: i }));

describe("whether to say anything", () => {
  it("says nothing when the best model is answering", () => {
    expect(degradedTier(on(BEST_TIER, WINDOW))).toBeNull();
  });

  it("says nothing about a single fallback", () => {
    /* One request landing on the wrong side of a per-minute window happens
       all day and means nothing. */
    const recent = [...on(BEST_TIER, WINDOW - 1), { via: "mistral", at: 9 }];
    expect(degradedTier(recent)).toBeNull();
  });

  it("says nothing until it has heard from enough requests", () => {
    expect(degradedTier(on("mistral", WINDOW - 1))).toBeNull();
    expect(degradedTier([])).toBeNull();
  });

  it("speaks up once the fallback is doing the work", () => {
    expect(degradedTier(on("mistral", WINDOW))).toBe("mistral");
  });

  it("names the model actually answering, not just 'not the best'", () => {
    const recent = [
      { via: "gemini", at: 1 },
      { via: "mistral", at: 2 },
      { via: "mistral", at: 3 },
      { via: "mistral", at: 4 },
    ];
    expect(degradedTier(recent)).toBe("mistral");
  });

  it("looks only at the recent window, so recovery is noticed", () => {
    /* The ceiling frees up every minute; a state that outlived the problem
       would be its own kind of lie. */
    const recovered = [...on("mistral", 8), ...on(BEST_TIER, WINDOW)];
    expect(degradedTier(recovered)).toBeNull();
  });

  it("ignores answers that never reported a tier", () => {
    const recent = [
      ...on("mistral", WINDOW),
      { via: null, at: 98 },
      { via: undefined, at: 99 },
    ];
    expect(degradedTier(recent)).toBe("mistral");
  });
});

describe("what it says", () => {
  it("names the consequence, not the plumbing", () => {
    const note = degradedNote("mistral");
    expect(note).toContain("mistral");
    expect(note).toMatch(/rate-limited/);
    expect(note).toMatch(/rougher/);
  });

  it("does not apologise or give advice they cannot act on", () => {
    const note = degradedNote("mistral");
    expect(note).not.toMatch(/sorry|please|try again|upgrade/i);
  });
});
