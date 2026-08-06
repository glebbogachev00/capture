import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { limitFromEnv, modelRateLimit, rateLimit } from "./limiter";

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

  it("a limit of 0 disables the gate entirely — the local single-user case", () => {
    for (let i = 0; i < 500; i++) {
      expect(rateLimit("unlimited", 0)).toMatchObject({ allowed: true });
    }
  });
});

describe("limitFromEnv", () => {
  afterEach(() => {
    delete process.env.CAPTURE_TEST_LIMIT;
  });

  it("falls back when the var is unset", () => {
    delete process.env.CAPTURE_TEST_LIMIT;
    expect(limitFromEnv("CAPTURE_TEST_LIMIT", 40)).toBe(40);
  });

  it("reads a valid number", () => {
    process.env.CAPTURE_TEST_LIMIT = "7";
    expect(limitFromEnv("CAPTURE_TEST_LIMIT", 40)).toBe(7);
  });

  it("treats 0 as off, not a fallback", () => {
    process.env.CAPTURE_TEST_LIMIT = "0";
    expect(limitFromEnv("CAPTURE_TEST_LIMIT", 40)).toBe(0);
  });

  it("falls back on junk or negatives", () => {
    process.env.CAPTURE_TEST_LIMIT = "banana";
    expect(limitFromEnv("CAPTURE_TEST_LIMIT", 40)).toBe(40);
    process.env.CAPTURE_TEST_LIMIT = "-3";
    expect(limitFromEnv("CAPTURE_TEST_LIMIT", 40)).toBe(40);
  });
});