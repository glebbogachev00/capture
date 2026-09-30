/**
 * Confirmation stays for fifteen seconds, or until the next capture retires it.
 * Opening again cancels the previous clock so each receipt gets its full window.
 *
 * Closing clears the banner, highlights, and suggestion through one `onClose`
 * channel in the hook. Capture Undo availability has a separate lifetime and
 * must not keep a success receipt visible.
 */

export const RECEIPT_MS = 15_000;

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
