import { describe, expect, it } from "vitest";
import { suggestionOutcome } from "./suggestionRecord";
import type { Suggestion } from "./boardOps";

const merge: Suggestion = {
  kind: "home",
  targetId: "retake",
  targetName: "Retake",
  reason: "same subject",
  sourceKind: "thread",
  sourceId: "t2",
  verb: "Merge",
};
const move: Suggestion = { ...merge, sourceKind: "action", sourceId: "a1", verb: "Move" };
const dup: Suggestion = {
  kind: "duplicate",
  targetId: "retake",
  targetName: "Retake",
  reason: "same words",
  sourceId: "a9",
  sourceKind: "action",
};

describe("what a suggestion teaches the personal model", () => {
  it("accept and dismiss are mirror images of the same proposal", () => {
    /* If accepting teaches about merging while dismissing teaches about a
       different subject, the model learns from a conversation that never
       happened. Both sides must name the same target. */
    for (const s of [merge, move, dup]) {
      const yes = suggestionOutcome(s, true);
      const no = suggestionOutcome(s, false);
      expect(yes.rule).toContain('"Retake"');
      expect(no.rule).toContain('"Retake"');
      expect(yes.rule).not.toBe(no.rule);
    }
  });

  it("the rule names the target, never the source id", () => {
    /* A rule naming t2 or a9 would never match anything again. */
    for (const s of [merge, move, dup]) {
      for (const accepted of [true, false]) {
        const r = suggestionOutcome(s, accepted);
        expect(r.rule).not.toMatch(/t2|a9/);
        expect(r.context).not.toMatch(/t2|a9/);
      }
    }
  });

  it("a merge and a move teach different verbs", () => {
    expect(suggestionOutcome(merge, true).rule).toBe('Merge threads into "Retake"');
    expect(suggestionOutcome(move, true).rule).toBe('Move actions into "Retake"');
  });

  it("waving off a duplicate protects the pair from being flagged again", () => {
    expect(suggestionOutcome(dup, false).rule).toBe('Don\'t treat "Retake" as a duplicate');
    expect(suggestionOutcome(dup, true).rule).toBe('Drop duplicates of "Retake"');
  });

  it("the history row says what happened in plain words", () => {
    expect(suggestionOutcome(move, true).context).toBe("moved an action into Retake");
    expect(suggestionOutcome(merge, false).context).toBe("kept a thread out of Retake");
    expect(suggestionOutcome(dup, true).context).toBe("dropped a duplicate of Retake");
  });
});
