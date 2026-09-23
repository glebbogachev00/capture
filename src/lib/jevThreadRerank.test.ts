import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import {
  JEV_OPENROUTER_ENDPOINT,
  JEV_OPENROUTER_MODEL,
  buildJevThreadRerankRequest,
  isJevThreadRerankShadowEnabled,
  runJevThreadRerank,
  scheduleJevThreadRerankShadow,
} from "./jevThreadRerank";

const candidates = [
  { id: "private-thread-a", name: "Annual pricing", about: "Pricing model tradeoffs." },
  { id: "private-thread-b", name: "Webhook reliability", about: "Retry and delivery failures." },
];

const input = {
  capture: "I am still comparing annual and monthly pricing.",
  candidates,
  sorterThreadId: "private-thread-a",
  sorterCreatedNewThread: false,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Jev OpenRouter contract", () => {
  it("uses the dedicated Decisions endpoint and pinned current model", () => {
    const request = buildJevThreadRerankRequest(input);

    expect(JEV_OPENROUTER_ENDPOINT).toBe("https://openrouter.ai/api/alpha/decisions");
    expect(JEV_OPENROUTER_MODEL).toBe("typesafe/jev-1.13");
    expect(request.model).toBe(JEV_OPENROUTER_MODEL);
    expect(request).not.toHaveProperty("provider");
    expect(request.questions.destination).toMatchObject({ type: "choice" });
    expect(Object.keys(request.questions.destination.criteria)).toEqual([
      "thread_0",
      "thread_1",
      "new_thread",
    ]);
  });

  it("sends only bounded routing text and opaque option indexes", () => {
    const request = buildJevThreadRerankRequest({
      ...input,
      capture: "x".repeat(10_000),
      candidates: candidates.map((candidate) => ({
        ...candidate,
        name: candidate.name.repeat(100),
        about: candidate.about.repeat(100),
      })),
    });
    const serialized = JSON.stringify(request);

    expect(request.state.capture.length).toBeLessThanOrEqual(2_000);
    expect(request.state).toEqual({ capture: request.state.capture });
    expect(request.questions.destination.criteria.thread_0.length).toBeLessThanOrEqual(900);
    expect(serialized).not.toContain("private-thread-a");
    expect(serialized).not.toContain("private-thread-b");
  });

  it("maps a validated choice distribution back to local candidate ids", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        answers: {
          destination: {
            type: "choice",
            choice: "thread_1",
            confidence: 0.72,
            probabilities: { thread_0: 0.2, thread_1: 0.7, new_thread: 0.1 },
          },
        },
        id: "gen-dec-synthetic",
        model: "typesafe/jev-1.13-20260917",
        provider: "TypeSafe",
        usage: { input_tokens: 250, output_tokens: 12, cost: 0.0000105 },
      })
    );

    const result = await runJevThreadRerank(input, {
      apiKey: "synthetic-key",
      fetcher,
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      JEV_OPENROUTER_ENDPOINT,
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer synthetic-key",
          "Content-Type": "application/json",
        },
      })
    );
    expect(result.selected).toEqual({
      kind: "existing",
      threadId: "private-thread-b",
      candidateIndex: 1,
    });
    expect(result.ranked.map((candidate) => candidate.kind === "existing" ? candidate.threadId : candidate.kind)).toEqual([
      "private-thread-b",
      "private-thread-a",
      "new_thread",
    ]);
  });

  it("preserves new_thread as an explicit abstention", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        answers: {
          destination: {
            type: "choice",
            choice: "new_thread",
            confidence: 0.9,
            probabilities: { thread_0: 0.05, thread_1: 0.05, new_thread: 0.9 },
          },
        },
        model: "typesafe/jev-1.13-20260917",
        usage: { input_tokens: 200, output_tokens: 10 },
      })
    );

    const result = await runJevThreadRerank(input, {
      apiKey: "synthetic-key",
      fetcher,
    });

    expect(result.selected).toEqual({ kind: "new_thread" });
    expect(result.ranked[0]).toEqual({ kind: "new_thread", probability: 0.9 });
  });

  it("rejects malformed or unknown choices instead of guessing", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        answers: {
          destination: {
            type: "choice",
            choice: "invented",
            confidence: 1,
            probabilities: { invented: 1 },
          },
        },
        model: "typesafe/jev-1.13-20260917",
        usage: { input_tokens: 1, output_tokens: 1 },
      })
    );

    await expect(
      runJevThreadRerank(input, { apiKey: "synthetic-key", fetcher })
    ).rejects.toThrow("invalid OpenRouter Decisions response");
  });

  it("rejects a choice distribution that does not sum to one", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        answers: {
          destination: {
            type: "choice",
            choice: "thread_0",
            confidence: 0.9,
            probabilities: { thread_0: 0.9, thread_1: 0.5, new_thread: 0.1 },
          },
        },
        model: "typesafe/jev-1.13-20260917",
        usage: { input_tokens: 1, output_tokens: 1 },
      })
    );

    await expect(
      runJevThreadRerank(input, { apiKey: "synthetic-key", fetcher })
    ).rejects.toThrow("invalid OpenRouter Decisions response");
  });
});

describe("Jev shadow gate", () => {
  it("is disabled unless the dedicated flag and OpenRouter key are both present", () => {
    expect(isJevThreadRerankShadowEnabled({})).toBe(false);
    expect(
      isJevThreadRerankShadowEnabled({
        OPENROUTER_API_KEY: "synthetic-key",
        CAPTURE_JEV_THREAD_RERANK_SHADOW: "0",
      })
    ).toBe(false);
    expect(
      isJevThreadRerankShadowEnabled({
        CAPTURE_JEV_THREAD_RERANK_SHADOW: "1",
      })
    ).toBe(false);
    expect(
      isJevThreadRerankShadowEnabled({
        OPENROUTER_API_KEY: "synthetic-key",
        CAPTURE_JEV_THREAD_RERANK_SHADOW: "1",
      })
    ).toBe(true);
  });

  it("does not schedule or call the network while disabled", async () => {
    const schedule = vi.fn();
    const fetcher = vi.fn();
    const acquire = vi.fn();

    expect(
      await scheduleJevThreadRerankShadow(input, {
        authorization: { mode: "cloud", ownerId: "owner-a", acquireDeferredManagedAiAdmission: acquire },
        env: {},
        schedule,
        fetcher,
      })
    ).toBe(false);
    expect(acquire).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("skips an unbounded candidate set rather than logging a partial comparison", async () => {
    const schedule = vi.fn();
    const many = Array.from({ length: 41 }, (_, index) => ({
      id: `thread-${index}`,
      name: `Thread ${index}`,
      about: `Synthetic candidate ${index}`,
    }));

    expect(
      await scheduleJevThreadRerankShadow({ ...input, candidates: many }, {
        env: {
          OPENROUTER_API_KEY: "synthetic-key",
          CAPTURE_JEV_THREAD_RERANK_SHADOW: "1",
        },
        schedule,
      })
    ).toBe(false);
    expect(schedule).not.toHaveBeenCalled();
  });

  it("fails closed when the platform cannot schedule after-response work", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const release = vi.fn().mockResolvedValue(undefined);

    expect(
      await scheduleJevThreadRerankShadow(input, {
        authorization: {
          mode: "cloud",
          ownerId: "owner-a",
          acquireDeferredManagedAiAdmission: vi.fn().mockResolvedValue({ release }),
        },
        env: {
          OPENROUTER_API_KEY: "synthetic-key",
          CAPTURE_JEV_THREAD_RERANK_SHADOW: "1",
        },
        schedule: () => {
          throw new Error("no request context");
        },
      })
    ).toBe(false);
    expect(release).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith("[capture-ops]", {
      version: 1,
      event: "managed_ai_provider_attempt",
      outcome: "failure",
      reason: "provider_unavailable",
      latency: "not_measured",
      count: "one",
    });
    expect(JSON.stringify(info.mock.calls)).not.toContain(input.capture);
  });

  it("runs after the response and logs only aggregate comparison fields", async () => {
    let task: (() => void | Promise<void>) | undefined;
    const schedule = vi.fn((callback: () => void | Promise<void>) => {
      task = callback;
    });
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const release = vi.fn().mockResolvedValue(undefined);
    const acquire = vi.fn().mockResolvedValue({ release });
    const fetcher = vi.fn(async () =>
      Response.json({
        answers: {
          destination: {
            type: "choice",
            choice: "thread_0",
            confidence: 0.8,
            probabilities: { thread_0: 0.8, thread_1: 0.1, new_thread: 0.1 },
          },
        },
        model: "typesafe/jev-1.13-20260917",
        provider: "TypeSafe",
        usage: { input_tokens: 250, output_tokens: 12, cost: 0.0000105 },
      })
    );

    expect(
      await scheduleJevThreadRerankShadow(input, {
        authorization: {
          mode: "cloud",
          ownerId: "owner-a",
          acquireDeferredManagedAiAdmission: acquire,
        },
        env: {
          OPENROUTER_API_KEY: "synthetic-key",
          CAPTURE_JEV_THREAD_RERANK_SHADOW: "1",
        },
        schedule,
        fetcher,
      })
    ).toBe(true);
    expect(acquire).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
    await Promise.resolve(task?.());
    expect(acquire).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();

    expect(info).toHaveBeenCalledWith("[capture-ops]", {
      version: 1,
      event: "managed_ai_provider_attempt",
      outcome: "success",
      reason: "none",
      latency: "not_measured",
      count: "2_9",
    });
    const logged = JSON.stringify(info.mock.calls);
    expect(logged).not.toContain(input.capture);
    expect(logged).not.toContain("Annual pricing");
    expect(logged).not.toContain("private-thread-a");
    expect(logged).not.toContain("synthetic-key");
  });

  it("contains shadow failures without changing the caller path or logging payloads", async () => {
    let task: (() => void | Promise<void>) | undefined;
    const schedule = (callback: () => void | Promise<void>) => {
      task = callback;
    };
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const fetcher = vi.fn(async () => new Response(input.capture, { status: 503 }));

    expect(
      await scheduleJevThreadRerankShadow(input, {
        env: {
          OPENROUTER_API_KEY: "synthetic-key",
          CAPTURE_JEV_THREAD_RERANK_SHADOW: "1",
        },
        schedule,
        fetcher,
      })
    ).toBe(true);
    await expect(Promise.resolve(task?.())).resolves.toBeUndefined();
    expect(info).toHaveBeenCalledWith("[capture-ops]", {
      version: 1,
      event: "managed_ai_provider_attempt",
      outcome: "failure",
      reason: "provider_unavailable",
      latency: "not_measured",
      count: "one",
    });
    expect(JSON.stringify(info.mock.calls)).not.toContain(input.capture);
  });
});
