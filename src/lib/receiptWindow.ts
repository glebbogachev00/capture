/**
 * How long the "Landed in X" receipt stays on screen — the little clock
 * with two complaints behind it.
 *
 * The first version cleared at 4.5 seconds: gone before the slowest flow
 * could be read, taking the Undo button with it ("where is the undo
 * button"). The second never cleared ("it doesn't have to stay there
 * forever... maybe thirty seconds"). Thirty-five seconds is the number
 * that survived both, and it is a CEILING, not a lifetime — the next
 * capture starting retires the receipt early, because a stale "Landed in
 * X" over words still being sorted misreports the board.
 *
 * The machine exists for one further reason: with a bare setTimeout, the
 * first receipt's timer outlives it and closes the SECOND receipt early —
 * open at t=0, open again at t=20s, and the screen goes blank at t=35s
 * with fifteen seconds stolen. Opening here always cancels the previous
 * clock, so every receipt gets its full window.
 *
 * Closing goes through one channel (`onClose`) whether the clock ran out
 * or the next capture retired it, so everything that must leave with the
 * banner — the banner text, the row highlights, the suggestion under it —
 * leaves together, wired once in the hook.
 */

export const RECEIPT_MS = 35_000;

export type ReceiptWindow = {
  /** A receipt is on screen: give it a full window from now. */
  open: () => void;
  /** Take it down now — the next capture started, or Undo consumed it. */
  retire: () => void;
};

export function createReceiptWindow(
  onClose: () => void,
  ms = RECEIPT_MS,
  setT: (fn: () => void, ms: number) => unknown = (fn, t) =>
    setTimeout(fn, t),
  clearT: (id: unknown) => void = (id) =>
    clearTimeout(id as ReturnType<typeof setTimeout>)
): ReceiptWindow {
  let timer: unknown = null;
  const cancel = () => {
    if (timer !== null) {
      clearT(timer);
      timer = null;
    }
  };
  return {
    open() {
      cancel();
      timer = setT(() => {
        timer = null;
        onClose();
      }, ms);
    },
    retire() {
      cancel();
      onClose();
    },
  };
}
