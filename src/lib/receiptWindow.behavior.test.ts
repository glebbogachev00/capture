import { describe, expect, it } from "vitest";
import { createReceiptWindow, RECEIPT_MS } from "./receiptWindow";

/** Manual timers, so the stolen-window bug can be staged deterministically. */
function clock() {
  let queue: { fn: () => void; at: number }[] = [];
  let now = 0;
  return {
    set: (fn: () => void, ms: number) => {
      const t = { fn, at: now + ms };
      queue.push(t);
      return t;
    },
    clear: (id: unknown) => {
      queue = queue.filter((t) => t !== id);
    },
    advance(ms: number) {
      now += ms;
      const due = queue.filter((t) => t.at <= now);
      queue = queue.filter((t) => t.at > now);
      for (const t of due) t.fn();
    },
  };
}

describe("the receipt window", () => {
  it("stays fifteen seconds, then leaves on its own", () => {
    expect(RECEIPT_MS).toBe(15_000);

    const c = clock();
    let closes = 0;
    const w = createReceiptWindow(() => closes++, RECEIPT_MS, c.set, c.clear);
    w.open();
    c.advance(RECEIPT_MS - 1);
    expect(closes).toBe(0); // still up, still readable, Undo still reachable
    c.advance(1);
    expect(closes).toBe(1); // gone before it becomes furniture
  });

  it("a second receipt gets its FULL window — the first one's clock dies", () => {
    /* A second capture before expiry must cancel the first timer. */
    const c = clock();
    let closes = 0;
    const w = createReceiptWindow(() => closes++, RECEIPT_MS, c.set, c.clear);
    w.open();
    c.advance(5_000);
    w.open(); // the second capture's receipt
    c.advance(RECEIPT_MS - 5_000); // when the first clock would fire
    expect(closes).toBe(0); // not stolen
    c.advance(4_999);
    expect(closes).toBe(0);
    c.advance(1); // the second receipt's own ceiling
    expect(closes).toBe(1);
  });

  it("retiring takes it down now and leaves no clock behind", () => {
    /* Sort start and Undo both retire the banner. The cancelled clock must
       be truly dead: a receipt opened right after must not inherit it. */
    const c = clock();
    let closes = 0;
    const w = createReceiptWindow(() => closes++, RECEIPT_MS, c.set, c.clear);
    w.open();
    c.advance(5_000);
    w.retire();
    expect(closes).toBe(1); // immediately, not on the old schedule
    w.open(); // the very next capture's receipt
    c.advance(RECEIPT_MS - 5_000); // when the retired clock would have fired
    expect(closes).toBe(1); // still up
    c.advance(5_000);
    expect(closes).toBe(2); // its own full window, then gone
  });

  it("retiring when nothing is up still closes cleanly, exactly once", () => {
    /* The hook retires on every sort start, shown receipt or not — the
       close channel is how the row highlights and suggestion clear too, so
       it must be safe to fire from a blank state. */
    const c = clock();
    let closes = 0;
    const w = createReceiptWindow(() => closes++, RECEIPT_MS, c.set, c.clear);
    w.retire();
    expect(closes).toBe(1);
    c.advance(RECEIPT_MS * 2);
    expect(closes).toBe(1); // and no clock was ever armed
  });
});
