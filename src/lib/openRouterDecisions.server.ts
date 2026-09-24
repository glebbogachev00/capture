import "server-only";

import { z } from "zod";

export const OPENROUTER_DECISIONS_ENDPOINT =
  "https://openrouter.ai/api/alpha/decisions";

const REQUEST_TIMEOUT_MS = 5_000;
const PRIVATE_PROVIDER_POLICY = Object.freeze({
  allow_fallbacks: false,
  data_collection: "deny" as const,
  zdr: true,
});

const Envelope = z.strictObject({
  answers: z.unknown(),
  id: z.string().optional(),
  model: z.string(),
  provider: z.string().optional(),
  usage: z.strictObject({
    input_tokens: z.number().nonnegative(),
    output_tokens: z.number().nonnegative(),
    cost: z.number().nonnegative().optional(),
  }),
});

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

async function boundedBySignal<T>(work: () => Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new DOMException("Decisions request cancelled", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    void Promise.resolve()
      .then(work)
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", onAbort));
  });
}

type DecisionsQuestion = {
  type: "choice" | "noul" | "score";
  instructions: string;
  criteria?: unknown;
};

export type OpenRouterDecisionsErrorCode =
  | "request_failed"
  | "http_error"
  | "invalid_response";

export class OpenRouterDecisionsError extends Error {
  readonly code: OpenRouterDecisionsErrorCode;
  readonly status?: number;

  constructor(code: OpenRouterDecisionsErrorCode, status?: number) {
    super(
      code === "http_error" && status
        ? `OpenRouter Decisions request failed (${status})`
        : code === "request_failed"
          ? "OpenRouter Decisions request failed"
          : "invalid OpenRouter Decisions response"
    );
    this.name = "OpenRouterDecisionsError";
    this.code = code;
    this.status = status;
  }
}

export type OpenRouterDecisionsResult<Answers> = {
  answers: Answers;
  model: string;
  provider?: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cost?: number;
  };
};

/**
 * One no-retry Decisions request with a policy callers cannot weaken.
 * Feature adapters own state, questions, answer schemas, and local mapping;
 * this boundary owns destination, privacy routing, timeout, and safe errors.
 */
export async function submitOpenRouterDecisions<Answers>({
  apiKey,
  model,
  state,
  questions,
  answersSchema,
  fetcher = fetch,
  signal,
}: {
  apiKey: string;
  model: string;
  state: unknown;
  questions: Record<string, DecisionsQuestion>;
  answersSchema: z.ZodType<Answers>;
  fetcher?: Fetcher;
  signal?: AbortSignal;
}): Promise<OpenRouterDecisionsResult<Answers>> {
  let response: Response;
  const requestSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
    : AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  try {
    response = await boundedBySignal(() => fetcher(OPENROUTER_DECISIONS_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        provider: PRIVATE_PROVIDER_POLICY,
        state,
        questions,
      }),
      signal: requestSignal,
    }), requestSignal);
  } catch {
    throw new OpenRouterDecisionsError("request_failed");
  }

  if (!response.ok) {
    throw new OpenRouterDecisionsError("http_error", response.status);
  }

  try {
    const envelope = Envelope.parse(
      await boundedBySignal(() => response.json(), requestSignal),
    );
    const answers = answersSchema.parse(envelope.answers);
    return {
      answers,
      model: envelope.model,
      provider: envelope.provider,
      usage: {
        inputTokens: envelope.usage.input_tokens,
        outputTokens: envelope.usage.output_tokens,
        cost: envelope.usage.cost,
      },
    };
  } catch {
    throw new OpenRouterDecisionsError("invalid_response");
  }
}

export function safeOpenRouterDecisionsFailure(error: unknown): {
  name: string;
  code?: OpenRouterDecisionsErrorCode;
  status?: number;
} {
  if (error instanceof OpenRouterDecisionsError) {
    return {
      name: error.name,
      code: error.code,
      ...(error.status === undefined ? {} : { status: error.status }),
    };
  }
  return { name: error instanceof Error ? error.name : "Error" };
}
