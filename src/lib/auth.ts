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

/**
 * `__Host-` pins the cookie to this origin in production (Secure, Path=/, no
 * Domain), so a subdomain can neither read it nor replay it. Dev runs over
 * plain http, which browsers refuse to pair with `__Host-`, so the prefix is
 * dropped there.
 */
export const AUTH_COOKIE =
  process.env.NODE_ENV === "production"
    ? "__Host-capture_auth"
    : "capture_auth";
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

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return toHex(digest);
}

/**
 * Compare a candidate against the stored password.
 *
 * Both sides are hashed first so the comparison runs over fixed-length
 * strings: a wrong-length candidate no longer leaks its length through an
 * early return in timingSafeEqual.
 */
export async function checkPassword(
  candidate: string,
  actual: string
): Promise<boolean> {
  const [a, b] = await Promise.all([sha256Hex(candidate), sha256Hex(actual)]);
  return timingSafeEqual(a, b);
}
