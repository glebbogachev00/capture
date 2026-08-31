import { describe, expect, it } from "vitest";
import { TANGLE_EVERY_MS, createTangleGate } from "./tangleGate";

describe("the tangle gate, as behavior", () => {
  it("asks at most once a day, unasked", () => {
    const g = createTangleGate(null);
    expect(g.tryClaim(1000, false)).toBe(true);
    expect(g.tryClaim(2000, false)).toBe(false);
    expect(g.tryClaim(1000 + TANGLE_EVERY_MS, false)).toBe(true);
  });

  it("a person pressing Tidy is never stopped by the daily gate", () => {
    const g = createTangleGate(500);
    expect(g.tryClaim(1000, false)).toBe(false);
    expect(g.tryClaim(1000, true)).toBe(true);
  });

  it("a failed attempt gives the day back — the week-of-silence bug", () => {
    /* The shipped incident: the clock was stamped before the work and kept
       on failure, so every failed model call cost twenty hours. With the
       release, a failure costs nothing: the very next look may try. */
    const g = createTangleGate(null);
    expect(g.tryClaim(1000, false)).toBe(true);
    g.release();
    expect(g.tryClaim(2000, false)).toBe(true);
  });

  it("a success keeps the day claimed", () => {
    const g = createTangleGate(null);
    g.tryClaim(1000, false);
    /* no release — the attempt produced its answer */
    expect(g.tryClaim(5000, false)).toBe(false);
    expect(g.askedAt()).toBe(1000);
  });

  it("release after a fresh first claim returns to never-asked", () => {
    const g = createTangleGate(null);
    g.tryClaim(1000, false);
    g.release();
    expect(g.askedAt()).toBeNull();
  });
});
