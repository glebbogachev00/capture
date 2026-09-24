import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

vi.mock("server-only", () => ({}));

import {
  OPENROUTER_DECISIONS_ENDPOINT,
  OpenRouterDecisionsError,
  submitOpenRouterDecisions,
} from "./openRouterDecisions.server";

const Answers = z.strictObject({
  relevant: z.strictObject({
    type: z.literal("noul"),
    noul: z.number().min(0).max(1),
  }),
});

describe("OpenRouter Decisions transport", () => {
  it("locks privacy routing, endpoint, timeout signal, and makes one request", async () => {
    const fetcher = vi.fn<(
      input: RequestInfo | URL,
      init?: RequestInit
    ) => Promise<Response>>().mockResolvedValue(Response.json({
      answers: { relevant: { type: "noul", noul: 0.8 } },
      model: "typesafe/jev-1.13-20260917",
      provider: "TypeSafe",
      usage: { input_tokens: 20, output_tokens: 2, cost: 0.000001 },
    }));

    await submitOpenRouterDecisions({
      apiKey: "synthetic-key",
      model: "typesafe/jev-1.13",
      state: { text: "synthetic" },
      questions: {
        relevant: { type: "noul", instructions: "Is this relevant?" },
      },
      answersSchema: Answers,
      fetcher,
      // The runtime must ignore unrecognized caller fields rather than allow
      // privacy policy or destination overrides.
      provider: { allow_fallbacks: true, data_collection: "allow", zdr: false },
      endpoint: "https://example.invalid/leak",
    } as Parameters<typeof submitOpenRouterDecisions>[0] & Record<string, unknown>);

    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe(OPENROUTER_DECISIONS_ENDPOINT);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(init?.body))).toMatchObject({
      provider: {
        allow_fallbacks: false,
        data_collection: "deny",
        zdr: true,
      },
    });
  });

  it("uses the caller-owned answer schema while parsing the shared envelope", async () => {
    const result = await submitOpenRouterDecisions({
      apiKey: "synthetic-key",
      model: "typesafe/jev-1.13",
      state: "synthetic",
      questions: { relevant: { type: "noul", instructions: "Is this relevant?" } },
      answersSchema: Answers,
      fetcher: async () => Response.json({
        answers: { relevant: { type: "noul", noul: 0.8 } },
        model: "typesafe/jev-1.13-20260917",
        usage: { input_tokens: 20, output_tokens: 2 },
      }),
    });

    expect(result.answers.relevant.noul).toBe(0.8);
    expect(result.usage).toEqual({ inputTokens: 20, outputTokens: 2, cost: undefined });
  });

  it("returns only safe typed failures and never reads or exposes response bodies", async () => {
    const privateText = "private synthetic payload echo";
    const fetcher = vi.fn(async () => new Response(privateText, { status: 503 }));

    const error = await submitOpenRouterDecisions({
      apiKey: "synthetic-key",
      model: "typesafe/jev-1.13",
      state: privateText,
      questions: { relevant: { type: "noul", instructions: "Is this relevant?" } },
      answersSchema: Answers,
      fetcher,
    }).catch((caught) => caught);

    expect(error).toBeInstanceOf(OpenRouterDecisionsError);
    expect(error).toMatchObject({ code: "http_error", status: 503 });
    expect(JSON.stringify(error)).not.toContain(privateText);
    expect(String(error)).not.toContain(privateText);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("normalizes malformed envelopes without retrying or leaking content", async () => {
    const fetcher = vi.fn(async () => Response.json({
      answers: { relevant: { type: "noul", noul: "private malformed value" } },
      model: "typesafe/jev-1.13-20260917",
      usage: { input_tokens: 20, output_tokens: 2 },
    }));

    await expect(submitOpenRouterDecisions({
      apiKey: "synthetic-key",
      model: "typesafe/jev-1.13",
      state: "synthetic",
      questions: { relevant: { type: "noul", instructions: "Is this relevant?" } },
      answersSchema: Answers,
      fetcher,
    })).rejects.toMatchObject({ code: "invalid_response" });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("hard-bounds a response body reader that ignores abort", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const response = Response.json({ ok: true });
    Object.defineProperty(response, "json", {
      value: () => new Promise<never>(() => {}),
    });
    const pending = submitOpenRouterDecisions({
      apiKey: "synthetic-key",
      model: "typesafe/jev-1.13",
      state: "synthetic",
      questions: { relevant: { type: "noul", instructions: "Is this relevant?" } },
      answersSchema: Answers,
      fetcher: async () => response,
      signal: controller.signal,
    });
    let settled = false;
    void pending.catch(() => { settled = true; });

    await vi.advanceTimersByTimeAsync(124);
    expect(settled).toBe(false);
    controller.abort(new DOMException("shared route deadline", "TimeoutError"));
    await expect(pending).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("hard-bounds a provider that ignores abort at the caller's shared deadline", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    let requestSignal: AbortSignal | undefined;
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      requestSignal = init?.signal ?? undefined;
      return new Promise<Response>(() => {});
    });

    const pending = submitOpenRouterDecisions({
      apiKey: "synthetic-key",
      model: "typesafe/jev-1.13",
      state: "synthetic",
      questions: { relevant: { type: "noul", instructions: "Is this relevant?" } },
      answersSchema: Answers,
      fetcher,
      signal: controller.signal,
    });
    let settled = false;
    void pending.catch(() => { settled = true; });

    await vi.advanceTimersByTimeAsync(124);
    expect(settled).toBe(false);
    controller.abort(new DOMException("shared route deadline", "TimeoutError"));
    await expect(pending).rejects.toMatchObject({ code: "request_failed" });
    expect(requestSignal?.aborted).toBe(true);
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
