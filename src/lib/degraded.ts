/**
 * Whether the app is running on its best model or a stand-in.
 *
 * The provider chain falls through silently, which is the point of a chain
 * — a spent free tier should not stop a capture from landing. But silence
 * turned a rate limit into six weeks of "it randomly got worse": the fastest
 * provider allows a fixed number of tokens per minute, and every request
 * over that was answered by a weaker model with nothing on screen to say so.
 * On one measured judgement the two scored 22% and 100%.
 *
 * The person could not have known. They experienced an app that was sharp
 * some days and stupid others, with no pattern they could name and nothing
 * to report. That is the failure this fixes — not the fallback itself, which
 * is doing its job, but the fact that it was invisible.
 *
 * Deliberately not an error and not a warning. It is a state, closer to a
 * signal-strength indicator than an alert: shown while it is true, gone when
 * it is not, and never blocking anything.
 */

/** The tier the chain prefers, and the one everything was measured on. */
export const BEST_TIER = "groq";

/**
 * How many recent answers to weigh.
 *
 * One fallback is nothing — a single request landing on the wrong side of a
 * per-minute window happens all day and costs almost nothing. What matters
 * is a run of them, which means the ceiling has been reached rather than
 * brushed.
 */
export const WINDOW = 4;
/** Below this share of the window, it is noise rather than a state. */
const ENOUGH = 0.75;

export type Answered = { via?: string | null; at: number };

/**
 * Is the app currently running on a stand-in?
 *
 * Returns the tier doing the work, or null when things are normal — which
 * includes not having heard from enough requests yet to say. Saying nothing
 * is the right answer far more often than saying something.
 */
export function degradedTier(recent: Answered[]): string | null {
  const seen = recent.filter((r) => r.via).slice(-WINDOW);
  if (seen.length < WINDOW) return null;

  const off = seen.filter((r) => r.via !== BEST_TIER);
  if (off.length / seen.length < ENOUGH) return null;

  /* Name the one actually answering, not just "not the best one" — which
     model is doing the work is the part worth knowing. */
  const counts = new Map<string, number>();
  for (const r of off) counts.set(r.via!, (counts.get(r.via!) ?? 0) + 1);
  let worst: string | null = null;
  let most = 0;
  for (const [via, n] of counts)
    if (n > most) {
      most = n;
      worst = via;
    }
  return worst;
}

/**
 * What to tell them, in one line.
 *
 * Plain about the consequence, because "using a fallback provider" means
 * nothing to someone wondering why their notes are landing in the wrong
 * place. No apology and no advice: there is nothing they can do about a
 * rate limit, and pretending otherwise wastes their attention.
 */
export function degradedNote(tier: string): string {
  return `Running on ${tier} — the usual model is rate-limited, so sorting will be rougher until it frees up.`;
}
