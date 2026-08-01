/**
 * A tiny per-key sliding-window rate limiter for the login gate.
 *
 * In-memory on purpose: capture is one self-hosted instance, so a single
 * module-level Map is a fair approximation. On a serverless host the map is
 * per-warm-instance — still a real barrier for a lone brute-force session,
 * just not a hard global cap, which is the right trade-off here.
 */

export type LimitResult = { allowed: boolean; retryAfterSec: number };

const DEFAULT_LIMIT = 5;
const DEFAULT_WINDOW = 15 * 60_000; // 15 minutes

const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(
  key: string,
  limit = DEFAULT_LIMIT,
  windowMs = DEFAULT_WINDOW
): LimitResult {
  const now = Date.now();
  const b = buckets.get(key);

  // No bucket yet, or the window rolled over — start fresh.
  if (!b || now > b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSec: 0 };
  }

  b.count += 1;
  if (b.count > limit) {
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((b.resetAt - now) / 1000)),
    };
  }
  return { allowed: true, retryAfterSec: 0 };
}