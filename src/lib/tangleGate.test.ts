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
  it("gives the day back when the attempt fails", () => {
    /* The clock is still claimed up front — two renders must not both
       start the work — so what matters is that the failure path restores
       whatever it replaced, rather than leaving today's stamp behind. */
    const catchBlock = source.slice(
      source.indexOf("} catch {", source.indexOf("tangleAskedAt.current = Date.now()")),
      source.indexOf("setTangleBusy(false)", source.indexOf("tangleAskedAt.current = Date.now()"))
    );
    expect(catchBlock).toMatch(/tangleAskedAt\.current = askedBefore/);
    expect(catchBlock).toMatch(/TANGLE_ASKED_KEY/);
  });

  it("remembers what the clock said before claiming it", () => {
    const before = source.indexOf("const askedBefore = tangleAskedAt.current");
    const claim = source.indexOf("tangleAskedAt.current = Date.now()");
    expect(before, "askedBefore should exist").toBeGreaterThan(-1);
    expect(before).toBeLessThan(claim);
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

  it("still holds the daily gate when nobody asked", () => {
    /* The gate is the whole reason the app is not annoying. A nudge lifts
       it; the absence of one must not. */
    expect(source).toMatch(
      /if \(!askedFor && asked && Date\.now\(\) - asked < TANGLE_EVERY_MS\) return;/
    );
  });
});
