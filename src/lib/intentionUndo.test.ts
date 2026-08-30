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

describe("walking away from an intention", () => {
  it("discarding a draft parks the words instead of deleting them", () => {
    /* "I don't want it to be an intention" is a judgement about the kind,
       not permission to delete the thought. The old discard nulled the
       draft — the only copy of four minutes of talking — and the person
       reported the loss in exactly those words: "I literally lost that
       thought, which came as an inspiration." */
    const discard = hook.slice(
      hook.indexOf("const discardDraft"),
      hook.indexOf("const updateIntention")
    );
    expect(discard).toMatch(/unsorted: true/);
    expect(discard).toMatch(/withLedger/);
    /* The banner renders as "Landed in {x}." — so the string must read as
       a PLACE, and the durable promise is where the words went, not the
       phrasing around it. */
    expect(discard).toMatch(/Actions, unsorted/i);
  });

  it("a draft backed by an existing action still discards clean", () => {
    /* Converting an action opens a draft COPY — the action stays on the
       board, so parking the words again would duplicate them. */
    const discard = hook.slice(
      hook.indexOf("const discardDraft"),
      hook.indexOf("const updateIntention")
    );
    expect(discard).toMatch(/if \(fromAction \|\| !d\?\.rawInput\.trim\(\)\) return;/);
  });

  it("a misfiled intention can be un-made from its own screen, words kept", () => {
    /* The banner's Undo covers the first minutes; this covers the day-later
       discovery. Delete answers "I don't want this thought" — un-make
       answers "this thought is not an intention". */
    const unmake = hook.slice(
      hook.indexOf("const unmakeIntention"),
      hook.indexOf("const deleteIntention")
    );
    expect(unmake).toMatch(/it\.rawInput \|\| it\.expandedIntention/);
    expect(unmake).toMatch(/unsorted: true/);
    expect(unmake).toMatch(/intentions: latest\.current\.intentions\.filter/);
    expect(view).toMatch(/Not an intention/);
  });
});
