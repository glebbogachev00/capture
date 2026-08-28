import { describe, it, expect } from "vitest";

/**
 * When a suggested thread name is worth offering.
 *
 * The untangle proposal can suggest renaming the thread notes keep leaving,
 * and there is exactly one case where that is the fix: the name LISTS a kind
 * of note that is moving out. "Bugs, Issues and Additions" kept collecting
 * additions because its own name told every sort they belonged there, while
 * the person had decided they belonged elsewhere. Dropping "Additions" stops
 * the label fighting the rule.
 *
 * Everything else is the model renaming for its own sake. Watched on a real
 * board it proposed "Capture." → "Capture app", which fixes nothing and
 * makes a good list of moves look careless. A thread's name is its identity.
 *
 * The rule below lives in the untangle route; this is the same predicate,
 * kept honest by the cases that actually occurred.
 */
function narrows(from: string, suggested: string): boolean {
  const words = (t: string) =>
    t.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);
  const old = new Set(words(from));
  return (
    !!suggested &&
    suggested !== from &&
    suggested.length < from.length &&
    words(suggested).every((w) => old.has(w))
  );
}

describe("a rename worth offering", () => {
  it("drops the category that is leaving", () => {
    expect(narrows("Bugs, Issues and Additions", "Bugs")).toBe(true);
    expect(narrows("Bugs, Issues and Additions", "Bugs and Issues")).toBe(true);
  });

  it("refuses a rename that invents a word", () => {
    /* The real one it tried. Fixes nothing, and renaming someone's thread
       for no reason is worse than staying quiet. */
    expect(narrows("Capture.", "Capture app")).toBe(false);
    expect(narrows("Retake", "Retake demos")).toBe(false);
  });

  it("refuses a longer name, however sensible it sounds", () => {
    expect(narrows("Bugs", "Bugs, Issues and Additions")).toBe(false);
  });

  it("refuses the same name back", () => {
    expect(narrows("Bugs", "Bugs")).toBe(false);
  });

  it("ignores punctuation and case when comparing words", () => {
    expect(narrows("Bugs, Issues and Additions", "bugs")).toBe(true);
  });

  it("refuses an empty suggestion", () => {
    expect(narrows("Bugs, Issues and Additions", "")).toBe(false);
  });

  it("refuses a shorter name built from different words", () => {
    /* Shorter is not the test — dropping a listed category is. */
    expect(narrows("Bugs, Issues and Additions", "Defects")).toBe(false);
  });
});
