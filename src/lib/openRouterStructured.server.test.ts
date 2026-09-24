import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("server-only", () => ({}));

import { generateOpenRouterStructured } from "./openRouterStructured.server";

const schema = z.object({ value: z.string(), count: z.number().int() });
const signal = new AbortController().signal;

describe("OpenRouter structured transport", () => {
  it("sends one strict private JSON-schema request and validates the answer", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(init?.headers).toMatchObject({ Authorization: "Bearer synthetic-key" });
      expect(body).toMatchObject({
        model: "openai/gpt-5-mini",
        max_tokens: 5_000,
        reasoning: { effort: "medium" },
        response_format: {
          type: "json_schema",
          json_schema: { name: "capture_semantic_interpretation", strict: true },
        },
        provider: {
          order: ["openai", "azure"],
          only: ["openai", "azure"],
          allow_fallbacks: true,
          require_parameters: true,
          data_collection: "deny",
          zdr: true,
        },
      });
      expect(body).not.toHaveProperty("temperature");
      expect(body.response_format.json_schema.schema).not.toHaveProperty("$schema");
      return Response.json({ choices: [{ message: { content: JSON.stringify({ value: "ok", count: 2 }) } }] });
    });

    await expect(generateOpenRouterStructured({
      modelId: "openai/gpt-5-mini",
      prompt: "synthetic prompt",
      schema,
      signal,
      fetcher,
      apiKey: "synthetic-key",
    })).resolves.toEqual({ value: "ok", count: 2 });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("uses bounded medium reasoning for GPT-5 mini semantic decomposition", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({
        model: "openai/gpt-5-mini",
        reasoning: { effort: "medium" },
      });
      return Response.json({
        choices: [{ message: { content: JSON.stringify({ value: "ok", count: 1 }) } }],
      });
    });

    await expect(generateOpenRouterStructured({
      modelId: "openai/gpt-5-mini",
      prompt: "synthetic prompt",
      schema,
      signal,
      fetcher,
      apiKey: "synthetic-key",
    })).resolves.toEqual({ value: "ok", count: 1 });
  });

  it("uses exact priority Google endpoints for the fixed Gemini Preview candidate", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({
        model: "google/gemini-3.8-flash",
        max_tokens: 8_000,
        reasoning: { effort: "medium" },
        provider: {
          order: ["google-ai-studio/priority", "google-vertex/global/priority"],
          only: ["google-ai-studio/priority", "google-vertex/global/priority"],
          allow_fallbacks: true,
          require_parameters: true,
          data_collection: "deny",
          zdr: true,
        },
      });
      return Response.json({
        choices: [{ message: { content: JSON.stringify({ value: "ok", count: 1 }) } }],
      });
    });

    await expect(generateOpenRouterStructured({
      modelId: "google/gemini-3.8-flash",
      prompt: "synthetic prompt",
      schema,
      signal,
      fetcher,
      apiKey: "synthetic-key",
    })).resolves.toEqual({ value: "ok", count: 1 });
  });

  it("marks token-budget truncation as non-retryable transport evidence", async () => {
    await expect(generateOpenRouterStructured({
      modelId: "openai/gpt-5-mini",
      prompt: "synthetic prompt",
      schema,
      signal,
      fetcher: vi.fn(async () => Response.json({
        choices: [{ finish_reason: "length", message: { content: "" } }],
      })),
      apiKey: "synthetic-key",
    })).rejects.toMatchObject({ statusCode: 502, provider: "openrouter", phase: "length" });
  });

  it("fails closed before transport for unknown model overrides", async () => {
    const fetcher = vi.fn();
    await expect(generateOpenRouterStructured({
      modelId: "unknown/model",
      prompt: "synthetic prompt",
      schema,
      signal,
      fetcher,
      apiKey: "synthetic-key",
    })).rejects.toMatchObject({ statusCode: 422, provider: "openrouter", phase: "model" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("fails closed on missing credentials, HTTP rejection, malformed JSON, and invalid schema output", async () => {
    await expect(generateOpenRouterStructured({
      modelId: "model", prompt: "prompt", schema, signal, fetcher: vi.fn(), apiKey: undefined,
    })).rejects.toMatchObject({ statusCode: 401 });

    await expect(generateOpenRouterStructured({
      modelId: "openai/gpt-5-mini", prompt: "prompt", schema, signal,
      fetcher: vi.fn(async () => new Response(null, { status: 402 })), apiKey: "key",
    })).rejects.toMatchObject({ statusCode: 402 });

    await expect(generateOpenRouterStructured({
      modelId: "openai/gpt-5-mini", prompt: "prompt", schema, signal,
      fetcher: vi.fn(async () => Response.json({ choices: [{ message: { content: "{" } }] })), apiKey: "key",
    })).rejects.toMatchObject({ statusCode: 502 });

    await expect(generateOpenRouterStructured({
      modelId: "openai/gpt-5-mini", prompt: "prompt", schema, signal,
      fetcher: vi.fn(async () => Response.json({ choices: [{ message: { content: JSON.stringify({ value: "ok" }) } }] })), apiKey: "key",
    })).rejects.toThrow();
  });
});
