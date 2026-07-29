/**
 * Turn a gateway failure into something worth reading.
 *
 * The states below are all things the operator has to go and fix in the
 * dashboard, so "sort failed" would just send them to the logs. Anything
 * unrecognised stays vague on purpose — it may quote a provider verbatim.
 *
 * The gateway wraps the underlying APICallError in its own error class, so
 * both the message and the response body have to be read through the cause
 * chain rather than off the top-level error.
 */

type MaybeGatewayError = {
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
    const e = current as MaybeGatewayError;
    if (typeof e.message === "string") texts.push(e.message);
    if (typeof e.responseBody === "string") texts.push(e.responseBody);
    if (typeof e.statusCode === "number" && status === undefined) {
      status = e.statusCode;
    }
    current = e.cause;
  }

  return { text: texts.join(" "), status };
}

export function explain(error: unknown): { message: string; status: number } {
  const { text, status } = unwrap(error);
  const generic = "The sort didn't go through.";

  if (
    text.includes("customer_verification_required") ||
    text.includes("credit card on file")
  ) {
    return {
      message:
        "AI Gateway needs a card on file before it will serve requests — that also unlocks the free monthly credits. Add one in the Vercel dashboard under AI Gateway.",
      status: 503,
    };
  }

  if (text.includes("insufficient") || status === 402) {
    return {
      message: "AI Gateway credit is exhausted. Top up to keep sorting.",
      status: 503,
    };
  }

  if (status === 429) {
    return {
      message: "Too many captures at once. Try again shortly.",
      status: 429,
    };
  }

  if (status === 401 || status === 403) {
    return {
      message:
        "AI Gateway rejected the credentials. Check the gateway is enabled for this project.",
      status: 503,
    };
  }

  return { message: generic, status: 502 };
}
