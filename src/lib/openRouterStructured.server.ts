import "server-only";

import { z } from "zod";

const OPENROUTER_CHAT_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type OpenRouterEnvelope = {
  choices?: Array<{
    finish_reason?: string | null;
    message?: { content?: string | null };
  }>;
};

type OpenRouterModelPolicy = {
  maxTokens: number;
  reasoningEffort: "low" | "medium" | "high";
  endpoints: string[];
};

function modelPolicy(modelId: string): OpenRouterModelPolicy {
  if (modelId === "openai/gpt-5-mini") {
    return {
      maxTokens: 5_000,
      reasoningEffort: "medium",
      endpoints: ["openai", "azure"],
    };
  }
  if (modelId === "google/gemini-3.8-flash") {
    return {
      maxTokens: 8_000,
      reasoningEffort: "medium",
      endpoints: ["google-ai-studio/priority", "google-vertex/global/priority"],
    };
  }
  throw Object.assign(new Error("OpenRouter model has not passed Capture qualification"), {
    statusCode: 422,
    provider: "openrouter",
    phase: "model",
  });
}

export async function generateOpenRouterStructured<T>({
  modelId,
  prompt,
  schema,
  signal,
  fetcher = fetch,
  apiKey = process.env.OPENROUTER_API_KEY,
}: {
  modelId: string;
  prompt: string;
  schema: z.ZodType<T>;
  signal: AbortSignal;
  fetcher?: Fetcher;
  apiKey?: string;
}): Promise<T> {
  if (!apiKey) throw Object.assign(new Error("OpenRouter is not configured"), { statusCode: 401 });
  const policy = modelPolicy(modelId);
  const jsonSchema = z.toJSONSchema(schema);
  if (jsonSchema && typeof jsonSchema === "object") delete (jsonSchema as { $schema?: unknown }).$schema;
  const response = await fetcher(OPENROUTER_CHAT_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: modelId,
      messages: [{ role: "user", content: prompt }],
      // Reasoning tokens and the lossless structured answer share this budget.
      // 2,500 intermittently truncated complex captures; 8,000 let medium
      // reasoning consume the interactive deadline. Five thousand preserves
      // room for the segment ledger while bounding deliberation latency.
      max_tokens: policy.maxTokens,
      // Semantic Sort is Capture's core judgment path. Qualification showed
      // low reasoning could merge independently completable commitments, so
      // spend the additional reasoning budget while the route still enforces
      // its existing hard interactive deadline.
      reasoning: { effort: policy.reasoningEffort },
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "capture_semantic_interpretation",
          strict: true,
          schema: jsonSchema,
        },
      },
      provider: {
        // Prefer the model owner's endpoint, retain Azure as the same-model
        // fallback, and reject endpoints that cannot honor strict structured
        // output. This avoids speed-first routing without relying on Exacto,
        // which OpenRouter does not currently serve for this private request.
        order: policy.endpoints,
        only: policy.endpoints,
        allow_fallbacks: true,
        require_parameters: true,
        data_collection: "deny",
        zdr: true,
      },
    }),
    signal,
  });
  if (!response.ok) {
    throw Object.assign(new Error(`OpenRouter request failed (${response.status})`), {
      statusCode: response.status,
      provider: "openrouter",
      phase: "http",
    });
  }
  let envelope: OpenRouterEnvelope;
  try {
    envelope = await response.json() as OpenRouterEnvelope;
  } catch {
    throw Object.assign(new Error("OpenRouter returned invalid JSON"), {
      statusCode: 502,
      provider: "openrouter",
      phase: "response_json",
    });
  }
  const choice = envelope.choices?.[0];
  const content = choice?.message?.content;
  if (!content) {
    const truncated = choice?.finish_reason === "length";
    throw Object.assign(new Error("OpenRouter returned no structured output"), {
      statusCode: 502,
      provider: "openrouter",
      phase: truncated ? "length" : "empty",
    });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw Object.assign(new Error("OpenRouter returned malformed structured output"), {
      statusCode: 502,
      provider: "openrouter",
      phase: "content_json",
    });
  }
  const validated = schema.safeParse(parsed);
  if (!validated.success) {
    throw Object.assign(new Error("OpenRouter structured output failed schema validation"), {
      statusCode: 502,
      provider: "openrouter",
      phase: "schema",
    });
  }
  return validated.data;
}
