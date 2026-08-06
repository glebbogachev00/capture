import { NoProvidersError } from "./providers";

/**
 * Turn a model failure into something worth reading.
 *
 * Most of these are states the operator has to go and fix — a missing key, a
 * spent quota — so "sort failed" would just send them to the logs. Anything
 * unrecognised stays vague on purpose, since provider errors sometimes quote
 * the request back.
 *
 * The messages name the provider that actually failed. `withFallback` stamps
 * the failing tier onto the error before rethrowing, so a spent Groq key tells
 * you about Groq rather than blaming Google.
 */

type MaybeProviderError = {
  message?: unknown;
  statusCode?: unknown;
  responseBody?: unknown;
  cause?: unknown;
};

const PROVIDER_NAMES: Record<string, string> = {
  gemini: "Google AI Studio",
  groq: "Groq",
  mistral: "Mistral",
  openrouter: "OpenRouter",
};

/** The env var each provider's key lives in, so the message can say what to fix. */
const PROVIDER_ENV: Record<string, string> = {
  gemini: "GOOGLE_GENERATIVE_AI_API_KEY",
  groq: "GROQ_API_KEY",
  mistral: "MISTRAL_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

function providerOf(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth++) {
    const via = (current as { provider?: unknown })?.provider;
    if (typeof via === "string") return via;
    current = (current as { cause?: unknown })?.cause;
  }
  return undefined;
}

function unwrap(error: unknown) {
  const texts: string[] = [];
  let status: number | undefined;

  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth++) {
    const e = current as MaybeProviderError;
    if (typeof e.message === "string") texts.push(e.message);
    if (typeof e.responseBody === "string") texts.push(e.responseBody);
    if (typeof e.statusCode === "number" && status === undefined) {
      status = e.statusCode;
    }
    current = e.cause;
  }

  return { text: texts.join(" ").toLowerCase(), status };
}

export function explain(error: unknown): { message: string; status: number } {
  if (error instanceof NoProvidersError) {
    return {
      message:
        "No model provider is configured on the server. Add an API key and redeploy.",
      status: 503,
    };
  }

  const via = providerOf(error);
  const name = (via && PROVIDER_NAMES[via]) || "your model provider";
  const env = via ? PROVIDER_ENV[via] : null;

  const { text, status } = unwrap(error);

  if (
    text.includes("api key") ||
    text.includes("api_key") ||
    text.includes("unauthenticated")
  ) {
    return {
      message:
        "No usable " +
        name +
        " key on the server." +
        (env ? " Set " + env + " and redeploy." : ""),
      status: 503,
    };
  }

  if (status === 429 || text.includes("quota") || text.includes("rate limit")) {
    return {
      message:
        name +
        " is rate-limiting or the daily free quota is spent. Try again shortly.",
      status: 429,
    };
  }

  // A fresh provider account with no payment method answers 402 "payment
  // required" — a state the operator has to fix, not a transient failure.
  if (status === 402 || text.includes("payment") || text.includes("billing")) {
    return {
      message:
        name +
        " needs billing set up on the account before it will answer. Visit its dashboard.",
      status: 503,
    };
  }

  // Gemini refuses outright rather than returning a partial answer.
  if (text.includes("safety") || text.includes("blocked")) {
    return {
      message: "The model declined to sort that one.",
      status: 422,
    };
  }

  if (status === 401 || status === 403) {
    return {
      message:
        name +
        " rejected the key." +
        (env ? " Check " + env + " is valid and the API is enabled." : ""),
      status: 503,
    };
  }

  return { message: "The sort didn't go through.", status: 502 };
}
