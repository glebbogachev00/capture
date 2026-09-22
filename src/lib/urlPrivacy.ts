import type { BeforeSendEvent } from "@vercel/analytics/next";

const SENSITIVE_QUERY_KEYS = new Set([
  "checkout",
  "checkout_id",
  "checkout_session_id",
  "portal_session_id",
  "customer_session_id",
  "operationId",
  "operation_id",
  "receiptToken",
  "receipt_token",
  "token",
  "token_hash",
  "access_token",
  "refresh_token",
  "session_id",
  "owner_id",
  "user_id",
  "image_id",
]);

const CHECKOUT_RETURN_STATE = "__captureCheckoutReturn";

/** Preserve only a private boolean return marker, never the checkout identifier. */
export function snapshotCheckoutReturnState(value: string, state: unknown): unknown {
  try {
    const url = new URL(value);
    if (!url.searchParams.has("checkout_id")) return state;
    const previous = state && typeof state === "object" && !Array.isArray(state)
      ? state as Record<string, unknown>
      : {};
    return { ...previous, [CHECKOUT_RETURN_STATE]: true };
  } catch {
    return state;
  }
}

export function hasCheckoutReturnState(state: unknown): boolean {
  try {
    if (!state || typeof state !== "object" || Array.isArray(state)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(state, CHECKOUT_RETURN_STATE);
    return !!descriptor && "value" in descriptor && descriptor.value === true;
  } catch {
    return false;
  }
}

/** Return a same-origin browser location only when sensitive state was removed. */
export function redactBrowserUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  let changed = false;
  for (const key of [...url.searchParams.keys()]) {
    if (!SENSITIVE_QUERY_KEYS.has(key)) continue;
    url.searchParams.delete(key);
    changed = true;
  }
  if (!changed) return null;
  const query = url.searchParams.toString();
  return `${url.pathname}${query ? `?${query}` : ""}${url.hash}`;
}

/** Vercel receives route-level traffic only, never Capture-controlled URL state. */
export function sanitizeAnalyticsEvent(event: BeforeSendEvent): BeforeSendEvent | null {
  try {
    const url = new URL(event.url);
    return { ...event, url: `${url.origin}${url.pathname}` };
  } catch {
    return null;
  }
}
