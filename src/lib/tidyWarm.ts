/**
 * When it is worth buying a tidy reading before anyone asks for one.
 *
 * The Tidy badge is a free local scan, so it appears the moment something
 * is worth looking at. The model pass behind it used to start on the tap,
 * which meant the badge advertised a result that did not exist yet and the
 * person paid ten to twenty seconds for work that had not begun.
 *
 * Warming that reading early removes the wait, but it spends the same
 * quota a tap would and spends it even when the tap never comes. So the
 * decision is deliberately narrow, and it lives here rather than inside an
 * effect so it can be argued with in a test.
 */

/** The board must sit still this long before a warm is worth buying. */
export const WARM_STILL_MS = 25_000;
/** And no more than one warm inside this window, however busy the board. */
export const WARM_MIN_GAP_MS = 5 * 60_000;

export type WarmInput = {
  /** Playground visitors would be spending someone else's budget. */
  playground: boolean;
  /** High-confidence hits from the free local scan — the badge's number. */
  hint: number;
  /** A review is on screen; its contents must not move under the reader. */
  reviewOpen: boolean;
  /** The board's sync signature right now. */
  sig: string;
  /** The signature the cached reading was made against, if any. */
  cachedSig: string | null;
  /** A request already in flight. */
  inFlight: boolean;
  /** Epoch ms of the last warm, or 0 if none this session. */
  lastWarmAt: number;
  now: number;
};

/**
 * How long to wait before warming, or `null` for "do not".
 *
 * Returning a delay rather than a boolean keeps the caller a one-liner and
 * puts the rate limit in the same place as the reasons: a board that keeps
 * changing simply never reaches the end of its timer.
 */
export function warmDelay(i: WarmInput): number | null {
  if (i.playground) return null;
  if (i.inFlight) return null;
  /* Nothing the local scan is willing to put a number on: there is no
     badge, so there is no promise to make good on. */
  if (i.hint < 1) return null;
  if (i.reviewOpen) return null;
  /* Already read this exact board. */
  if (i.cachedSig !== null && i.cachedSig === i.sig) return null;
  const since = i.lastWarmAt ? i.now - i.lastWarmAt : Infinity;
  return Math.max(WARM_STILL_MS, WARM_MIN_GAP_MS - since);
}
