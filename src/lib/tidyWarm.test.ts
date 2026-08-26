import { describe, expect, it } from "vitest";
import { warmDelay, WARM_STILL_MS, WARM_MIN_GAP_MS } from "./tidyWarm";

const base = {
  playground: false,
  hint: 2,
  reviewOpen: false,
  sig: "sig-a",
  cachedSig: null,
  inFlight: false,
  lastWarmAt: 0,
  now: 1_000_000,
};

describe("warmDelay", () => {
  it("waits for the board to be still, then warms", () => {
    expect(warmDelay(base)).toBe(WARM_STILL_MS);
  });

  it("does not spend a visitor's tap on the owner's quota", () => {
    expect(warmDelay({ ...base, playground: true })).toBeNull();
  });

  it("buys nothing when the local scan found nothing", () => {
    // No badge means no promise was made, so there is nothing to make good.
    expect(warmDelay({ ...base, hint: 0 })).toBeNull();
  });

  it("leaves an open review alone", () => {
    // The rule the no-auto-rescan note protects: what the reader asked for
    // stays as it was.
    expect(warmDelay({ ...base, reviewOpen: true })).toBeNull();
  });

  it("does not re-read a board it has already read", () => {
    expect(warmDelay({ ...base, cachedSig: "sig-a" })).toBeNull();
  });

  it("does re-read once the board has changed", () => {
    expect(warmDelay({ ...base, cachedSig: "sig-old" })).toBe(WARM_STILL_MS);
  });

  it("never has two requests in flight", () => {
    expect(warmDelay({ ...base, inFlight: true })).toBeNull();
  });

  it("holds off until the gap since the last warm has passed", () => {
    // One minute ago: four minutes of the five-minute floor remain, and
    // that outlasts the stillness timer.
    const oneMinuteAgo = base.now - 60_000;
    expect(warmDelay({ ...base, lastWarmAt: oneMinuteAgo })).toBe(
      WARM_MIN_GAP_MS - 60_000
    );
  });

  it("falls back to the stillness timer once the gap is spent", () => {
    const longAgo = base.now - WARM_MIN_GAP_MS - 1;
    expect(warmDelay({ ...base, lastWarmAt: longAgo })).toBe(WARM_STILL_MS);
  });

  it("a busy board never reaches the end of its timer", () => {
    // Each change restarts the wait, so a capture session buys nothing —
    // only the pause afterwards does.
    const d = warmDelay(base);
    expect(d).toBeGreaterThan(10_000);
  });
});
