/**
 * Turn a model failure into something worth reading.
 *
 * Most of these are states the operator has to go and fix — a missing key, a
 * spent quota — so "sort failed" would just send them to the logs. Anything
 * unrecognised stays vague on purpose, since provider errors sometimes quote
 * the request back.
 *
 * Providers wrap their underlying call error in their own class, so the
 * message and body are read through the cause chain rather than off the top.
 */

type MaybeProviderError = {
  message?: unknown;
  statusCode?: unknown;
  responseBody?: unknown;
  cause?: unknown;
};

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
  const { text, status } = unwrap(error);

  if (
    text.includes("api key") ||
    text.includes("api_key") ||
    text.includes("unauthenticated")
  ) {
    return {
      message:
        "No usable Google AI Studio key on the server. Set GOOGLE_GENERATIVE_AI_API_KEY and redeploy.",
      status: 503,
    };
  }

  if (status === 429 || text.includes("quota") || text.includes("rate limit")) {
    return {
      message:
        "Google AI Studio is rate-limiting or the daily free quota is spent. Try again shortly.",
      status: 429,
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
        "Google AI Studio rejected the key. Check it is valid and that the Generative Language API is enabled.",
      status: 503,
    };
  }

  return { message: "The sort didn't go through.", status: 502 };
}
