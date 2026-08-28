import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * A failed sort must never change the shape of the board.
 *
 * When the model did not answer, the fallback used to branch on whichever
 * tab happened to be open. Standing on Threads minted a NEW THREAD named
 * after the first five words of what was said — so an error path made a
 * permanent structural decision, and every retry made another. Four
 * attempts at one thought left four threads on a real board, and undoing
 * them left the wreckage in the record.
 *
 * Worse, it fed back into the thing it was breaking: the sorter routes by
 * reading thread names, so a junk thread called "The next issue is action"
 * made every later capture harder to place. The failure degraded the next
 * attempt.
 *
 * The holding place is an unsorted action — flat, reversible, visibly
 * marked, and `resort` can later turn it into a thread, an action or an
 * intention. Everything the invented thread offered, without the
 * commitment.
 *
 * This reads the source because the fallback lives inside the hook and
 * cannot be called on its own. It is a guard against the branch coming
 * back, not a test of behaviour — the behaviour is covered by the mobile
 * suite, which captures with the model unavailable and checks that no
 * thread appears.
 */

const source = fs.readFileSync(
  path.join(process.cwd(), "src/hooks/useBoard.ts"),
  "utf8"
);

/** The block that runs when the sorter did not answer. */
function fallbackBlock(): string {
  const start = source.indexOf("const saveUnsorted");
  expect(start, "saveUnsorted should still exist").toBeGreaterThan(-1);
  const end = source.indexOf("withLedger", start);
  return source.slice(start, end);
}

describe("when the sorter does not answer", () => {
  it("never builds a thread out of the raw words", () => {
    /* The exact shape of the old bug: a thread named from a slice of what
       was said. If this ever returns, a rate limit starts reshaping the
       board again. */
    const block = fallbackBlock();
    expect(block).not.toMatch(/name:\s*body\.split/);
    expect(block).not.toMatch(/const fresh:\s*Thread/);
  });

  it("does not decide anything from which tab is open", () => {
    /* Where the person happens to be standing is not information about
       where a capture belongs. */
    const block = fallbackBlock();
    expect(block).not.toMatch(/tab === "threads"/);
  });

  it("still appends to a thread the person has open", () => {
    /* An open thread IS a stated destination — that one is the person's
       decision, not the error path's. */
    expect(fallbackBlock()).toMatch(/openThread/);
  });

  it("keeps the capture as an unsorted action", () => {
    const block = fallbackBlock();
    expect(block).toMatch(/unsorted:\s*true/);
    expect(block).toMatch(/actions:\s*\[action/);
  });

  it("says where it went and that it can still be sorted", () => {
    expect(fallbackBlock()).toMatch(/sort it when the model is back/i);
  });
});
