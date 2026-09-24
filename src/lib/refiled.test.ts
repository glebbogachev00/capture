import { describe, expect, it } from "vitest";
import { REFILE_WINDOW_MS, commandRule, isRefile, refileRule, undoRule } from "./refiled";
import { deriveRules } from "./rules";

const MIN = 60 * 1000;

describe("isRefile — fixing the sorter vs ordinary housekeeping", () => {
  it("a move minutes after the capture landed is a correction", () => {
    const at = 1_000_000;
    expect(isRefile(at, at + 30 * 1000)).toBe(true);
    expect(isRefile(at, at + 9 * MIN)).toBe(true);
  });

  it("a move the next day is reorganising, not a correction", () => {
    const at = 1_000_000;
    expect(isRefile(at, at + 24 * 60 * MIN)).toBe(false);
    expect(isRefile(at, at + REFILE_WINDOW_MS + 1)).toBe(false);
  });

  it("the boundary itself still counts", () => {
    const at = 1_000_000;
    expect(isRefile(at, at + REFILE_WINDOW_MS)).toBe(true);
  });

  it("a clock that went backwards is not a correction", () => {
    const at = 1_000_000;
    expect(isRefile(at, at - MIN)).toBe(false);
  });
});

describe("refileRule — what the fix teaches", () => {
  const GROCERIES = "Cold brew is the one thing I always keep stocked";

  it("names the subject the capture shares with its new home", () => {
    expect(
      refileRule("we are out of cold brew again, which is annoying", "Groceries", GROCERIES)
    ).toBe('Captures about "cold brew" belong in "Groceries"');
  });

  it("THE POINT: two phrasings of the same lesson produce the SAME rule", () => {
    /* The first build failed here. "cold brew again" and "cold brew" read as
       two unrelated rules, so neither ever reached the two-signal bar and the
       loop never compounded. The home's wording is the anchor now. */
    const a = refileRule("we are out of cold brew again, which is annoying", "Groceries", GROCERIES);
    const b = refileRule("need more cold brew, we ran out again this week", "Groceries", GROCERIES);
    const c = refileRule("cold brew supplies running low", "Groceries", GROCERIES);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("writes nothing when the home shares no subject yet", () => {
    /* This used to fall back to the capture's first content word, on the
       theory that a home which does not mention the subject yet still
       teaches something. It does not: the fallback produced rules anchored
       on whatever word happened to come first, and a rule anchored on a
       meaningless word fires on the wrong capture later. The move still
       happens; only the invented lesson is gone. */
    expect(
      refileRule("the espresso grinder burrs are worn", "Kitchen renovation", "counters and cabinets")
    ).toBeNull();
  });

  it("a shared subject is stable across phrasings", () => {
    const a = refileRule("the espresso machine is leaking", "Repairs", "the espresso machine needs looking at");
    const b = refileRule("espresso everywhere, the machine leaked again", "Repairs", "the espresso machine needs looking at");
    expect(a).toBe(b);
  });

  it("says nothing when there is nothing specific to say", () => {
    expect(refileRule("it is", "Groceries", "things to buy")).toBeNull();
    expect(refileRule("cold brew", "", "anything")).toBeNull();
  });
});

describe("undoRule — what an answered undo teaches", () => {
  it("names the subject, the right kind, and the wrong one", () => {
    expect(
      undoRule("We are out of cold brew again, which is annoying", "action", "thread")
    ).toBe('Captures about "cold brew" are a thread, not an action');
  });

  it("says nothing when the answer is the kind it already chose", () => {
    /* Not a correction, so there is nothing to learn. */
    expect(undoRule("Buy running clothes", "action", "action")).toBeNull();
  });

  it("says nothing when there is no subject to anchor on", () => {
    expect(undoRule("   ", "action", "thread")).toBeNull();
  });

  it("gives two captures about one subject the same rule, so they aggregate", () => {
    /* deriveRules groups by exact wording and needs two signals, so the
       rule has to be anchored on the subject rather than the sentence —
       otherwise every correction is a group of one and nothing is ever
       learned. */
    const a = undoRule("cold brew is out again", "action", "thread");
    const b = undoRule("cold brew, we ran out this week too", "action", "thread");
    expect(a).toBe(b);
  });
});

describe("commandRule — a destination named up front", () => {
  it("states where this kind of thing belongs", () => {
    expect(commandRule("cold brew is out again", "thread")).toBe(
      'Captures about "cold brew" are a thread'
    );
  });

  it("makes no claim about what it is not", () => {
    /* An answered undo follows a mistake you watched happen, so it can say
       "not a thread". A command is a preference asserted before the engine
       gave its opinion — it may well have agreed — so it only states the
       positive, and needs the ordinary two signals to be heard. */
    const rule = commandRule("cold brew is out again", "thread")!;
    expect(rule).not.toContain("not");
  });

  it("aggregates across captures about the same subject", () => {
    expect(commandRule("cold brew ran out", "thread")).toBe(
      commandRule("cold brew again, annoying", "thread")
    );
  });

  it("says nothing when there is no subject", () => {
    expect(commandRule("   ", "thread")).toBeNull();
  });
});

describe("a command is weaker evidence than an answered undo", () => {
  it("needs two signals where an answered undo needs one", () => {
    const commanded = (at: number) => ({
      id: "c" + at,
      at,
      proposalKind: "commanded" as const,
      accepted: true,
      context: "cold brew",
      rule: 'Captures about "cold brew" are a thread',
    });
    expect(deriveRules([commanded(1000)], [], 2000)).toHaveLength(0);
    expect(deriveRules([commanded(1000), commanded(1100)], [], 2000)).toHaveLength(1);
  });
});

describe("refileRule — a subject, or no rule at all", () => {
  it("names the subject the capture and its new home share", () => {
    expect(
      refileRule(
        "the espresso machine grinder keeps drifting",
        "Kitchen Equipment",
        "Kitchen Equipment espresso machine settings overview"
      )
    ).toBe('Captures about "espresso machine" belong in "Kitchen Equipment"');
  });

  it("writes nothing when the two share no subject", () => {
    /* A post draft moved into a thread of post drafts shares no words with
       it — the thing they have in common is their shape, which the series
       rule handles. Inventing a subject here produced 'Captures about
       "mark" belong in "Capture X posts"' from "Tue — mark-done". */
    expect(
      refileRule(
        "Tue — mark-done\n\nI had a list of 400 things and finished maybe 30.",
        "Capture X posts",
        "Capture X posts Mon — capture-two-places Tuesday 11pm I say to myself"
      )
    ).toBeNull();
  });

  it("still writes nothing without a home to name", () => {
    expect(refileRule("anything at all", "   ", "some thread text")).toBeNull();
  });
});
