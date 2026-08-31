import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * The two ways a person never gets asked about a tangled pair.
 *
 * Both were live at once on a real board. Its history recorded seven
 * corrections in the same direction — notes filed in "Capture." and moved
 * to "Bugs, Issues and Additions" — which the detector found every time it
 * was asked. It was never asked.
 *
 *   The daily gate was claimed before the work and never given back, so an
 *   attempt that failed still cost twenty hours of silence. Through a week
 *   when every model call was failing on exhausted quota, that meant the
 *   callout could not appear at all. The catch block said "asked again
 *   tomorrow" and did nothing to make that true.
 *
 *   And there was no way to ask. The callout was the only path, Tidy is
 *   the button people actually press when a board feels wrong, and Tidy
 *   did not look.
 *
 * This reads the source because both live inside the hook and cannot be
 * called on their own — a guard against the shape returning, in the same
 * spirit as failedSort.test.ts.
 */

const source = fs.readFileSync(
  path.join(process.cwd(), "src/hooks/useBoard.ts"),
  "utf8"
);

describe("being asked about a tangled pair", () => {
  it("delegates the gate to lib/tangleGate", () => {
    /* The rules — once a day, the nudge, failure returns the day — are now
       BEHAVIOR tests in tangleGate.behavior.test.ts, which replay the
       week-of-silence incident as an assertion. What this file guards is
       the seam: the hook must go through the gate, not re-grow inline
       clock arithmetic. */
    expect(source).toMatch(/tangleGate\.current\.tryClaim\(/);
    expect(source).toMatch(/tangleGate\.current\.release\(\)/);
    expect(source).not.toMatch(/Date\.now\(\) - asked < TANGLE_EVERY_MS/);
  });

  it("lets Tidy ask on demand, past the daily gate", () => {
    const organize = source.slice(
      source.indexOf("const runOrganize"),
      source.indexOf("const runOrganize") + 2000
    );
    expect(organize).toMatch(/setTangleNudge/);
    /* A pair already tried this session must be reconsidered, or pressing
       the button does nothing the second time. */
    expect(organize).toMatch(/tangleTried\.current\.clear\(\)/);
  });

  it("delegates the merge math to lib/tangleOps", () => {
    /* The absorb rules — every note leaving, actions following, an empty
       thread never absorbed — used to be pinned here as source greps,
       because the math lived inline in the hook and could not be called.
       It moved to lib/tangleOps and those rules are now BEHAVIOR tests in
       tangleOps.test.ts, which replay both of the feature's shipped bugs
       as assertions. What remains to guard here is the seam itself: the
       hook must go through the tested function, not grow a second copy of
       the math. */
    const accept = source.slice(
      source.indexOf("const acceptTangle"),
      source.indexOf("const dismissTangle")
    );
    expect(accept).toMatch(/applyTangleAccept\(/);
    expect(accept).toMatch(/takeAll = false/);
    expect(accept).not.toMatch(/frags\.filter/);
  });

  it("still holds the daily gate when nobody asked", () => {
    /* The gate exists so the app does not interrupt; only the nudge lifts
       it. The behavior lives in tangleGate.behavior.test.ts — here, the
       seam: the nudge is what tryClaim receives. */
    expect(source).toMatch(/tryClaim\(Date\.now\(\), askedFor\)/);
  });
});
