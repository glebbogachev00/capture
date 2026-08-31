import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Two ways an intention swallowed what went into it.
 *
 * Both reported the same way — "a lot of things I said got lost and I
 * cannot undo it" — and neither was a loss. One was a button that removed
 * itself; the other was text the app held and never rendered.
 *
 * Source guards, because both live where they cannot be called on their
 * own: one in the hook, one in a component with no test environment here.
 */

const hook = fs.readFileSync(
  path.join(process.cwd(), "src/hooks/useBoard.ts"),
  "utf8"
);
const view = fs.readFileSync(
  path.join(process.cwd(), "src/app/Intentions.tsx"),
  "utf8"
);

describe("landing an intention", () => {
  it("a new capture retires the previous receipt", () => {
    /* Persistence cuts both ways: the receipt must survive long enough to
       read, and must NOT survive the next capture starting — a stale
       "Landed in X" over words still being sorted misreports the board,
       and anything waiting on .landed as a finished-signal fires early. */
    const sortStarts = [...hook.matchAll(/setBusy\("Sorting"\)/g)];
    expect(sortStarts.length).toBeGreaterThanOrEqual(2);
    for (const m of sortStarts) {
      const before = hook.slice(Math.max(0, m.index - 700), m.index);
      expect(before).toMatch(/receiptWindow\.current!\.retire\(\)/);
    }
  });

  it("the receipt's clock lives in ONE place, and every site goes through it", () => {
    /* The timing itself (25-45s band, the stolen-window bug, retire
       semantics) is behavior-tested in lib/receiptWindow.behavior.test.
       This guards the wiring: no site may set a visible receipt around the
       policy — setLanded with text appears inside showReceipt and nowhere
       else, and showReceipt arms the window. */
    const direct = [...hook.matchAll(/setLanded\((?!null)[^)]/g)];
    expect(direct.length).toBe(1);
    expect(hook).toMatch(/receiptWindow\.current!\.open\(\)/);
  });

  it("leaves the banner up, because Undo lives inside it", () => {
    /* Every other capture leaves its banner until the next one. This path
       cleared it after 4.5s while canUndo stayed true — so the only way to
       press Undo disappeared, on the slowest thing the app makes. Several
       minutes of talking, and the window shut before there was anything to
       read. */
    const landing = hook.slice(
      hook.indexOf('showReceipt("Intention "'),
      hook.indexOf('showReceipt("Intention "') + 900
    );
    expect(landing).not.toMatch(/setTimeout\([^)]*setLanded\(null\)/);
  });

  it("still offers the undo at all", () => {
    /* The guard above is worthless if the path stops enabling undo. */
    const before = hook.lastIndexOf("setCanUndo(true)", hook.indexOf('showReceipt("Intention "'));
    expect(before).toBeGreaterThan(-1);
  });
});

describe("an intention's own words", () => {
  it("renders rawInput, not only the model's version", () => {
    /* rawInput was stored on every intention and displayed on none. */
    expect(view).toMatch(/intention\.rawInput/);
    expect(view).toMatch(/int-said-text/);
  });

  it("does not show it when it would only repeat the expanded wording", () => {
    /* A captured one-liner is its own expansion; a disclosure that opens
       onto the sentence above it is noise. */
    expect(view).toMatch(/spoken !== \(intention\.expandedIntention \?\? ""\)\.trim\(\)/);
  });

  it("keeps it folded and out of the way", () => {
    /* The expanded intention is the thing to act on. This is the record
       behind it — wanted occasionally, never first. */
    expect(view).toMatch(/aria-expanded=\{said\}/);
  });
});

describe("walking away from an intention", () => {
  it("discarding a draft records the words instead of deleting them", () => {
    /* The first fix parked them as an unsorted action — wrong in an
       obvious-in-hindsight way, because an intention is often minutes of
       talking and minutes of talking is not a task. Discard now writes the
       record entry the save would have written, marked undone from birth:
       said, then not kept, with the full text in history and a way back. */
    const discard = hook.slice(
      hook.indexOf("const discardDraft"),
      hook.indexOf("const updateIntention")
    );
    expect(discard).toMatch(/withLedger/);
    expect(discard).toMatch(/undone: true/);
    expect(discard).toMatch(/it's in the record/i);
    /* And nothing lands on the board. */
    expect(discard).not.toMatch(/unsorted: true/);
    expect(discard).not.toMatch(/actions: \[/);
  });

  it("a draft backed by an existing action still discards clean", () => {
    /* Converting an action opens a draft COPY — the action stays on the
       board, so recording the words again would double them. */
    const discard = hook.slice(
      hook.indexOf("const discardDraft"),
      hook.indexOf("const updateIntention")
    );
    expect(discard).toMatch(/if \(fromAction \|\| !d\?\.rawInput\.trim\(\)\) return;/);
  });

  it("an undone record entry offers the way back", () => {
    /* "You can still restore it in history." Restoring is just saying it
       again — the words return to the composer and sort fresh. */
    expect(view).toMatch(/Say it again/);
    expect(view).toMatch(/onRestore\(e\.said\)/);
  });
});
