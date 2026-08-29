import { describe, it, expect } from "vitest";
import { keepJudged, toCandidates, wordMatched, type OrganizeProposal } from "./organize";
import { EMPTY } from "./model";

const claim = (over: Partial<OrganizeProposal> = {}): OrganizeProposal => ({
  id: "fold_action:a1:t1",
  kind: "fold_action",
  confidence: "high",
  verb: "Fold in",
  sourceId: "a1",
  sourceName: "Add small sound effects to the demo music",
  targetId: "t1",
  targetName: "Retake",
  reason: 'both mention "small sound effects"',
  score: 90,
  origin: "local",
  ...over,
});

describe("sending word-matches to be judged", () => {
  it("sends the word-matched claims, not the staleness ones", () => {
    /* let_go and revisit_intention are not claims about meaning — they are
       claims about time, which a clock settles and a model cannot. */
    const ps = [
      claim(),
      claim({ id: "let_go:a9", kind: "let_go" }),
      claim({ id: "revisit_intention:i1", kind: "revisit_intention" }),
      claim({ id: "ai:1", origin: "ai" }),
    ];
    expect(wordMatched(ps).map((p) => p.id)).toEqual(["fold_action:a1:t1"]);
  });

  it("carries what is already in the destination", () => {
    /* Without it the judge is deciding on two names, which is the same
       impoverished view the word-matcher had. */
    const board = {
      ...EMPTY,
      threads: [
        {
          id: "t1",
          name: "Retake",
          at: 1,
          frags: [
            { id: "f1", text: "the render takes forever", at: 1 },
            { id: "f2", text: "scene markers need a rethink", at: 2 },
          ],
        },
      ],
    } as never;
    const [c] = toCandidates(board, [claim()]);
    expect(c.target).toBe("Retake");
    expect(c.targetContext).toContain("render takes forever");
    expect(c.targetContext).toContain("scene markers");
  });

  it("keeps only what survived, and takes the judge's reason", () => {
    const kept = keepJudged(
      [claim()],
      [{ id: "fold_action:a1:t1", keep: true, reason: "Both are about the demo you are recording" }]
    );
    expect(kept).toHaveLength(1);
    /* The whole point: the reason a person reads is a reason, not the
       evidence restated. */
    expect(kept[0].reason).toBe("Both are about the demo you are recording");
  });

  it("drops a claim the judge rejected", () => {
    expect(
      keepJudged([claim()], [{ id: "fold_action:a1:t1", keep: false, reason: null }])
    ).toEqual([]);
  });

  it("drops a claim the judge said nothing about", () => {
    /* Silence is not agreement. A verdict list that comes back short must
       not quietly promote the missing ones. */
    expect(keepJudged([claim()], [])).toEqual([]);
    expect(keepJudged([claim()], [{ id: "someone-else", keep: true, reason: "x" }])).toEqual([]);
  });

  it("falls back to the word-match reason if the judge gave none", () => {
    const kept = keepJudged(
      [claim()],
      [{ id: "fold_action:a1:t1", keep: true, reason: "   " }]
    );
    expect(kept[0].reason).toBe('both mention "small sound effects"');
  });
});
