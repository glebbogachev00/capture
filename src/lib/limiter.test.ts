import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { modelRateLimit, rateLimit } from "./limiter";

describe("rateLimit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows attempts up to the limit", () => {
    for (let i = 1; i <= 5; i++) {
      expect(rateLimit("one").allowed).toBe(true);
    }
  });

  it("blocks attempts past the limit within the window", () => {
    for (let i = 0; i < 5; i++) rateLimit("two");
    const blocked = rateLimit("two");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
  });

  it("resets once the window elapses", () => {
    for (let i = 0; i < 10; i++) rateLimit("three");
    expect(rateLimit("three").allowed).toBe(false);

    vi.advanceTimersByTime(15 * 60_000 + 1);
    expect(rateLimit("three").allowed).toBe(true);
  });

  it("tracks clients independently", () => {
    for (let i = 0; i < 10; i++) rateLimit("evildoer");
    expect(rateLimit("evildoer").allowed).toBe(false);
    expect(rateLimit("innocent").allowed).toBe(true);
  });

  it("shares the model bucket across clients only up to the model limit", () => {
    for (let i = 0; i < 40; i++) {
      expect(modelRateLimit("bot").allowed).toBe(true);
    }
    const blocked = modelRateLimit("bot");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
    // A different key is not punished by the bot's bucket.
    expect(modelRateLimit("another").allowed).toBe(true);
  });
});