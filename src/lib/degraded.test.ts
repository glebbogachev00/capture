import { describe, it, expect } from "vitest";
import { degradedTier, degradedNote, WINDOW, type Answered } from "./degraded";

/**
 * The chain falls through silently, and that silence was the bug: a
 * per-minute token ceiling meant a weaker model answered, with nothing on
 * screen to say so, and the app appeared to get worse at random for weeks.
 *
 * The bar for speaking up is deliberately high. One fallback is normal and
 * costs nothing; a run of them means the ceiling has been reached.
 */

const on = (
  via: string,
  n: number,
  routing: Pick<Answered, "preferred" | "fallback" | "fallbackReason"> = {
    preferred: "groq",
    fallback: true,
    fallbackReason: "rate_limit",
  }
) => Array.from({ length: n }, (_, i) => ({ via, at: i, ...routing }));

describe("whether to say anything", () => {
  it("says nothing when the configured preferred model is answering", () => {
    expect(degradedTier(on("openrouter", WINDOW, {
      preferred: "openrouter",
      fallback: false,
      fallbackReason: null,
    }))).toBeNull();
  });

  it("says nothing about a single fallback", () => {
    /* One request landing on the wrong side of a per-minute window happens
       all day and means nothing. */
    const recent = [
      ...on("groq", WINDOW - 1, {
        preferred: "groq",
        fallback: false,
        fallbackReason: null,
      }),
      ...on("mistral", 1),
    ];
    expect(degradedTier(recent)).toBeNull();
  });

  it("says nothing until it has heard from enough requests", () => {
    expect(degradedTier(on("mistral", WINDOW - 1))).toBeNull();
    expect(degradedTier([])).toBeNull();
  });

  it("speaks up once the fallback is doing the work", () => {
    expect(degradedTier(on("mistral", WINDOW))).toBe("mistral");
  });

  it("does not claim a rate limit for an ordinary provider failure", () => {
    expect(degradedTier(on("mistral", WINDOW, {
      preferred: "groq",
      fallback: true,
      fallbackReason: "provider_failure",
    }))).toBeNull();
  });

  it("does not treat a second key for the preferred provider as degraded", () => {
    expect(degradedTier(on("groq-2", WINDOW, {
      preferred: "groq",
      fallback: false,
      fallbackReason: "rate_limit",
    }))).toBeNull();
  });

  it("names the model actually answering, not just 'not the best'", () => {
    const recent = [
      ...on("gemini", 1),
      ...on("mistral", 3),
    ];
    expect(degradedTier(recent)).toBe("mistral");
  });

  it("looks only at the recent window, so recovery is noticed", () => {
    /* The ceiling frees up every minute; a state that outlived the problem
       would be its own kind of lie. */
    const recovered = [
      ...on("mistral", 8),
      ...on("groq", WINDOW, {
        preferred: "groq",
        fallback: false,
        fallbackReason: null,
      }),
    ];
    expect(degradedTier(recovered)).toBeNull();
  });

  it("ignores answers that never reported a tier", () => {
    const recent = [
      ...on("mistral", WINDOW),
      { via: null, at: 98, preferred: null, fallback: false, fallbackReason: null },
      { via: undefined, at: 99, preferred: null, fallback: false, fallbackReason: null },
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
