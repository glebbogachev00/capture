/**
 * When to ask about a tangled pair — the gate, as a thing with behavior.
 *
 * The rules were inline in the hook and testable only by grepping the
 * source, and the gate's one shipped bug was exactly the kind a grep
 * cannot see: the daily window was claimed BEFORE the work and never given
 * back on failure, so through a stretch when every model call failed, a
 * board with seven corrections between the same two threads was never
 * asked about them — twenty hours of silence per failed attempt.
 *
 * The rules:
 *   - At most once a day, unasked. The pair detection is free and runs
 *     every time; the model call is what is rationed.
 *   - A person pressing Tidy came LOOKING: the daily gate must not stop
 *     them (the nudge).
 *   - The day is claimed before the work (two renders must not both start
 *     it) and GIVEN BACK on failure, so a failed attempt costs nothing.
 */

export const TANGLE_EVERY_MS = 20 * 60 * 60 * 1000;

export type TangleGate = {
  /** May an attempt start now? Claims the day if yes. */
  tryClaim: (now: number, nudged: boolean) => boolean;
  /** The attempt failed: return the day so the next look can try again. */
  release: () => void;
  /** What the clock currently says (for persistence). */
  askedAt: () => number | null;
};

export function createTangleGate(initialAskedAt: number | null): TangleGate {
  let askedAt = initialAskedAt;
  let claimedFrom: number | null = null;

  return {
    tryClaim(now, nudged) {
      if (!nudged && askedAt !== null && now - askedAt < TANGLE_EVERY_MS)
        return false;
      claimedFrom = askedAt;
      askedAt = now;
      return true;
    },
    release() {
      askedAt = claimedFrom;
      claimedFrom = null;
    },
    askedAt: () => askedAt,
  };
}
