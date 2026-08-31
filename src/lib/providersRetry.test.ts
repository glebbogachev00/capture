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

describe("a second Groq account", () => {
  it("sits directly behind the first, not at the back of the chain", async () => {
    /* Rate limits are per organisation, so a spare key is a whole extra
       allowance of the same model. Falling from Groq to Groq costs nothing;
       falling to the next provider down cost 100% recall against 22% on one
       measured judgement. So the spare has to be adjacent. */
    vi.resetModules();
    process.env.GROQ_API_KEY = "one";
    process.env.GROQ_API_KEY_2 = "two";
    process.env.MISTRAL_API_KEY = "m";
    const { withFallback } = await import("./providers");

    const seen: string[] = [];
    await expect(
      withFallback(async (tier) => {
        seen.push(tier.name);
        throw new Error("connection refused");
      })
    ).rejects.toThrow();
    expect(seen.slice(0, 2)).toEqual(["groq", "groq-2"]);
  });

  it("changes nothing when there is only one key", async () => {
    vi.resetModules();
    process.env.GROQ_API_KEY = "one";
    delete process.env.GROQ_API_KEY_2;
    process.env.MISTRAL_API_KEY = "m";
    const { withFallback } = await import("./providers");

    const seen: string[] = [];
    await expect(
      withFallback(async (tier) => {
        seen.push(tier.name);
        throw new Error("connection refused");
      })
    ).rejects.toThrow();
    expect(seen).toEqual(["groq", "mistral"]);
  });
});

describe("a tier that is out for the day", () => {
  it("is skipped on the next request instead of probed again", async () => {
    vi.resetModules();
    process.env.GROQ_API_KEY = "one";
    process.env.MISTRAL_API_KEY = "m";
    const { withFallback, _resetDailyOut } = await import("./providers");
    _resetDailyOut();

    const daily = Object.assign(
      new Error(
        "Rate limit reached on tokens per day (TPD): Limit 200000. Please try again in 11m57s."
      ),
      { statusCode: 429 }
    );
    const calls: string[] = [];
    const attempt = async (tier: { name: string }) => {
      calls.push(tier.name);
      if (tier.name === "groq") throw daily;
      return "answered";
    };

    await withFallback(attempt);
    /* Learned once... */
    expect(calls).toEqual(["groq", "mistral"]);
    await withFallback(attempt);
    /* ...spared thereafter. The person waiting on a sort does not pay for
       a probe of a budget that refills over a day. */
    expect(calls).toEqual(["groq", "mistral", "mistral"]);
  });

  it("never skips its way to asking nobody", async () => {
    vi.resetModules();
    process.env.GROQ_API_KEY = "one";
    delete process.env.MISTRAL_API_KEY;
    const { withFallback, _resetDailyOut } = await import("./providers");
    _resetDailyOut();

    const daily = Object.assign(
      new Error("tokens per day (TPD) exceeded. Please try again in 5m."),
      { statusCode: 429 }
    );
    let calls = 0;
    await expect(
      withFallback(async () => {
        calls++;
        throw daily;
      })
    ).rejects.toThrow();
    const after = calls;
    /* The only tier is marked out — but a request must still ASK rather
       than fail without trying: being wrong about a recovery costs one
       call, refusing to try costs the capture. */
    await expect(
      withFallback(async () => {
        calls++;
        throw daily;
      })
    ).rejects.toThrow();
    expect(calls).toBeGreaterThan(after);
  });

  it("does not sit out the 18-second wait for a budget that refills over a day", async () => {
    vi.resetModules();
    process.env.GROQ_API_KEY = "one";
    delete process.env.MISTRAL_API_KEY;
    const { withFallback, _resetDailyOut } = await import("./providers");
    _resetDailyOut();

    const daily = Object.assign(
      new Error("on tokens per day (TPD). Please try again in 9m."),
      { statusCode: 429 }
    );
    const started = Date.now();
    await expect(withFallback(async () => Promise.reject(daily))).rejects.toThrow();
    /* The old path waited 18-25s before failing — pure waiting-room for the
       person, since a day does not roll over while they watch. */
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});

describe("what a provider failure may say in a log", () => {
  it("the person's words cannot reach the log line", async () => {
    /* The exact leak: an AI SDK APICallError carries the request body —
       the captured words — and the old log line printed the whole object
       into server logs. The sanitizer keeps tier, status and a bounded
       message; everything that can carry payload is discarded. */
    vi.resetModules();
    process.env.GROQ_API_KEY = "one";
    const { sanitizeProviderError } = await import("./providers");
    const SECRET = "I want to remove my mind frictions and my private fears";
    const sdkError = Object.assign(new Error("Bad request"), {
      name: "AI_APICallError",
      statusCode: 400,
      requestBodyValues: { prompt: SECRET },
      responseBody: `{"echo":"${SECRET}"}`,
      responseHeaders: { "x-request-id": "abc" },
      cause: new Error(SECRET),
      data: { messages: [{ content: SECRET }] },
    });
    const logged = sanitizeProviderError(sdkError);
    const flat = JSON.stringify(logged);
    expect(flat).not.toContain(SECRET);
    expect(flat).not.toContain("mind frictions");
    /* And it still says what a log needs to say. */
    expect(logged.name).toBe("AI_APICallError");
    expect(logged.status).toBe(400);
    expect(logged.message).toBe("Bad request");
  });

  it("even a payload-echoing message is bounded", async () => {
    vi.resetModules();
    process.env.GROQ_API_KEY = "one";
    const { sanitizeProviderError } = await import("./providers");
    const long = "x".repeat(5000);
    expect(sanitizeProviderError(new Error(long)).message.length).toBeLessThanOrEqual(200);
  });

  it("the raw error object never reaches console.warn", async () => {
    /* Seam guard: the chain may only log through the sanitizer. */
    const fs = await import("node:fs");
    const src = fs.readFileSync("src/lib/providers.ts", "utf8");
    const warns = [...src.matchAll(/console\.warn\(([\s\S]*?)\)/g)];
    for (const w of warns) {
      expect(w[1]).not.toMatch(/,\s*error\s*$/);
    }
    expect(src).toMatch(/sanitizeProviderError\(error\)/);
  });
});
