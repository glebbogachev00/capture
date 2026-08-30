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
  it("leaves the banner up, because Undo lives inside it", () => {
    /* Every other capture leaves its banner until the next one. This path
       cleared it after 4.5s while canUndo stayed true — so the only way to
       press Undo disappeared, on the slowest thing the app makes. Several
       minutes of talking, and the window shut before there was anything to
       read. */
    const landing = hook.slice(
      hook.indexOf('setLanded("Intention "'),
      hook.indexOf('setLanded("Intention "') + 900
    );
    expect(landing).not.toMatch(/setTimeout\([^)]*setLanded\(null\)/);
  });

  it("still offers the undo at all", () => {
    /* The guard above is worthless if the path stops enabling undo. */
    const before = hook.lastIndexOf("setCanUndo(true)", hook.indexOf('setLanded("Intention "'));
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
