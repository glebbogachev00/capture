import { describe, it, expect, vi } from "vitest";

/**
 * Every provider refusing at once is nearly always one thing: a per-minute
 * token allowance, spent. The provider says so, and says for how long. The
 * chain used to try each tier once and give up, so a capture failed to sort
 * over a ceiling that cleared before the person finished reading the error
 * — and on a real phone that failure then invented a junk thread.
 */

const limit = (msg = "Rate limit reached … Please try again in 12s") =>
  Object.assign(new Error(msg), { statusCode: 429 });

async function load() {
  vi.resetModules();
  process.env.GROQ_API_KEY = "test-a";
  process.env.MISTRAL_API_KEY = "test-b";
  return import("./providers");
}

describe("when every provider refuses", () => {
  it("waits and tries again if it was a rate limit", async () => {
    vi.useFakeTimers();
    const { withFallback } = await load();
    let calls = 0;
    const p = withFallback(async () => {
      calls += 1;
      /* Both tiers refuse on the first pass, the first tier answers on the
         second — exactly what a per-minute window rolling over looks like. */
      if (calls <= 2) throw limit();
      return "sorted";
    });
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(p).resolves.toMatchObject({ value: "sorted" });
    vi.useRealTimers();
  });

  it("gives up at once on a real outage", async () => {
    /* An outage does not get better for being asked twice, and the person
       is waiting on this capture. */
    const { withFallback } = await load();
    let calls = 0;
    await expect(
      withFallback(async () => {
        calls += 1;
        throw new Error("connection refused");
      })
    ).rejects.toThrow();
    expect(calls).toBe(2); // one attempt per tier, no second pass
  });

  it("never waits longer than the route can afford", async () => {
    /* The whole route is capped at sixty seconds; a provider asking for two
       minutes must not be taken literally. */
    vi.useFakeTimers();
    const { withFallback } = await load();
    let calls = 0;
    const p = withFallback(async () => {
      calls += 1;
      if (calls <= 2) throw limit("Rate limit reached … Please try again in 5m0s");
      return "sorted";
    });
    await vi.advanceTimersByTimeAsync(26_000);
    await expect(p).resolves.toMatchObject({ value: "sorted" });
    vi.useRealTimers();
  });
});
