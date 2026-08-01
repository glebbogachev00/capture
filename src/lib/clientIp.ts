/**
 * The caller's address, read from the most trustworthy source available.
 *
 * The leftmost `x-forwarded-for` value is whatever the client claims — trivially
 * spoofable, which would let a scraper rotate fake addresses and walk straight
 * around a rate limit. The rightmost value is the one appended by the nearest
 * trusted proxy, and Cloudflare / nginx stamp their own headers. Prefer those.
 */
export function clientIp(request: Request): string {
  const cf = request.headers.get("cf-connecting-ip");
  if (cf) return cf;
  const real = request.headers.get("x-real-ip");
  if (real) return real;
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) {
    const ips = fwd
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const last = ips[ips.length - 1];
    if (last) return last;
  }
  return "unknown";
}
