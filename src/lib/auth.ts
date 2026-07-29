/**
 * A single-user password gate.
 *
 * This is deliberately not a user system — there is one person and one
 * password. The cookie is an HMAC of an expiry timestamp keyed on the
 * password, so it cannot be forged without knowing it and stops working on
 * its own.
 *
 * When APP_PASSWORD is unset the gate is disabled, so a fresh clone runs
 * without configuration. Set it in production: the /api/sort route spends
 * real gateway credits, and an open one is an open tab on your account.
 */

export const AUTH_COOKIE = "capture_auth";
const SESSION_DAYS = 30;

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sign(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value)
  );
  return toHex(sig);
}

/** Compare without leaking where two strings first differ. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function createSessionValue(password: string): Promise<string> {
  const expires = Date.now() + SESSION_DAYS * 86_400_000;
  const payload = String(expires);
  return `${payload}.${await sign(payload, password)}`;
}

export async function isValidSession(
  cookieValue: string | undefined,
  password: string
): Promise<boolean> {
  if (!cookieValue) return false;
  const [payload, signature] = cookieValue.split(".");
  if (!payload || !signature) return false;

  const expires = Number(payload);
  if (!Number.isFinite(expires) || expires < Date.now()) return false;

  return timingSafeEqual(signature, await sign(payload, password));
}

export function checkPassword(candidate: string, actual: string): boolean {
  return timingSafeEqual(candidate, actual);
}
