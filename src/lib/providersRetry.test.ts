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

describe("operator provider preference", () => {
  async function attemptedOrder(jobPreference?: string) {
    vi.resetModules();
    process.env.GROQ_API_KEY = "one";
    process.env.OPENROUTER_API_KEY = "openrouter";
    delete process.env.GROQ_API_KEY_2;
    delete process.env.CEREBRAS_API_KEY;
    delete process.env.MISTRAL_API_KEY;
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    const { withFallback } = await import("./providers");
    const seen: string[] = [];
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(
      withFallback(async (tier) => {
        seen.push(tier.name);
        throw new Error("synthetic outage");
      }, jobPreference)
    ).rejects.toThrow("synthetic outage");
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.CAPTURE_MODEL_PROVIDER;
    return seen;
  }

  it("uses a job default when the operator did not choose a provider", async () => {
    delete process.env.CAPTURE_MODEL_PROVIDER;
    expect(await attemptedOrder("openrouter")).toEqual(["openrouter", "groq"]);
  });

  it("keeps an explicit operator preference ahead of a conflicting job default", async () => {
    process.env.CAPTURE_MODEL_PROVIDER = "openrouter";
    expect(await attemptedOrder("groq")).toEqual(["openrouter", "groq"]);
    delete process.env.CAPTURE_MODEL_PROVIDER;
  });
});

describe("fallback routing metadata", () => {
  it("reports an intentionally preferred OpenRouter answer as normal", async () => {
    vi.resetModules();
    process.env.GROQ_API_KEY = "one";
    process.env.OPENROUTER_API_KEY = "openrouter";
    process.env.CAPTURE_MODEL_PROVIDER = "openrouter";
    const { withFallback } = await import("./providers");

    const result = await withFallback(async () => "answered", "groq");
    expect(result).toMatchObject({
      via: "openrouter",
      preferred: "openrouter",
      fallback: false,
      fallbackReason: null,
    });
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.CAPTURE_MODEL_PROVIDER;
  });

  it("distinguishes a rate-limit fallback from an ordinary provider failure", async () => {
    vi.resetModules();
    process.env.GROQ_API_KEY = "one";
    process.env.MISTRAL_API_KEY = "m";
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.CAPTURE_MODEL_PROVIDER;
    const { withFallback } = await import("./providers");

    const rateLimited = await withFallback(async (tier) => {
      if (tier.name === "groq") throw limit();
      return "answered";
    });
    expect(rateLimited).toMatchObject({
      via: "mistral",
      preferred: "groq",
      fallback: true,
      fallbackReason: "rate_limit",
    });

    const failed = await withFallback(async (tier) => {
      if (tier.name === "groq") throw new Error("synthetic outage");
      return "answered";
    });
    expect(failed).toMatchObject({
      via: "mistral",
      preferred: "groq",
      fallback: true,
      fallbackReason: "provider_failure",
    });
  });

  it("does not blame the preferred provider for a later fallback tier's rate limit", async () => {
    vi.resetModules();
    process.env.GROQ_API_KEY = "one";
    process.env.MISTRAL_API_KEY = "m";
    process.env.OPENROUTER_API_KEY = "openrouter";
    delete process.env.GROQ_API_KEY_2;
    delete process.env.CEREBRAS_API_KEY;
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    delete process.env.CAPTURE_MODEL_PROVIDER;
    const { withFallback } = await import("./providers");

    const result = await withFallback(async (tier) => {
      if (tier.name === "groq") throw new Error("synthetic outage");
      if (tier.name === "mistral") throw limit();
      return "answered";
    });
    expect(result).toMatchObject({
      via: "openrouter",
      preferred: "groq",
      fallback: true,
      fallbackReason: "provider_failure",
    });
    delete process.env.OPENROUTER_API_KEY;
  });

  it("treats a second key for the preferred provider as the same model", async () => {
    vi.resetModules();
    process.env.GROQ_API_KEY = "one";
    process.env.GROQ_API_KEY_2 = "two";
    process.env.MISTRAL_API_KEY = "m";
    delete process.env.CAPTURE_MODEL_PROVIDER;
    const { withFallback } = await import("./providers");

    const result = await withFallback(async (tier) => {
      if (tier.name === "groq") throw limit();
      return "answered";
    });
    expect(result).toMatchObject({
      via: "groq-2",
      preferred: "groq",
      fallback: false,
      fallbackReason: "rate_limit",
    });
    delete process.env.GROQ_API_KEY_2;
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

    const first = await withFallback(attempt);
    /* Learned once... */
    expect(calls).toEqual(["groq", "mistral"]);
    expect(first).toMatchObject({ fallback: true, fallbackReason: "rate_limit" });
    const second = await withFallback(attempt);
    /* ...spared thereafter. The person waiting on a sort does not pay for
       a probe of a budget that refills over a day. */
    expect(calls).toEqual(["groq", "mistral", "mistral"]);
    expect(second).toMatchObject({ fallback: true, fallbackReason: "rate_limit" });
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
  it("retains only a fixed reason and never any provider-controlled string", async () => {
    vi.resetModules();
    process.env.GROQ_API_KEY = "one";
    const { sanitizeProviderError } = await import("./providers");
    const SECRET = "I want to remove my mind frictions and my private fears";
    const sdkError = Object.assign(new Error(`Bad request: ${SECRET}`), {
      name: "AI_APICallError",
      statusCode: 400,
      requestBodyValues: { prompt: SECRET },
      responseBody: `{"echo":"${SECRET}"}`,
      responseHeaders: { "x-request-id": "abc" },
      cause: new Error(SECRET),
      data: { messages: [{ content: SECRET }] },
    });
    expect(sanitizeProviderError(sdkError)).toEqual("provider_rejected");
    expect(JSON.stringify(sanitizeProviderError(sdkError))).not.toContain(SECRET);
    expect(sanitizeProviderError(Object.assign(new Error(SECRET), { statusCode: 429 })))
      .toBe("rate_limited");
    expect(sanitizeProviderError(new Error(SECRET))).toBe("provider_unavailable");
  });

  it("the provider chain logs only through the fixed operational logger", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("src/lib/providers.ts", "utf8");
    expect(src).not.toMatch(/console\.(?:log|info|warn|error|debug)/);
    expect(src).toMatch(/opsEvent\(/);
    expect(src).toMatch(/sanitizeProviderError\(error\)/);
  });
});
