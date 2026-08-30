import { describe, expect, it } from "vitest";
import { applySaveDraft } from "./intentionOps";
import { EMPTY, type Board } from "./model";

const draft = {
  rawInput:
    "I want to be someone who works two to four hours a day, stays focused without overworking, and finishes the day with energy left over.",
  expandedIntention: "I work two to four hours a day and finish with energy left over.",
  recommendedActions: ["I stop at four hours even mid-flow."],
  counterIntentions: ["I keep answering messages past the fourth hour."],
};

const ids = { intentionId: "int1", ledgerId: "led1" };

const board = (over: Partial<Board> = {}): Board => ({ ...EMPTY, ...over });

describe("saving a reviewed intention draft", () => {
  it("keeps the person's full words on the intention, not just the condensation", () => {
    /* The shipped complaint: minutes of talking became two lines and the
       rest was unreachable. rawInput riding on the intention is what "What
       you said" renders. */
    const { intention } = applySaveDraft(board(), draft, {}, ids, 100);
    expect(intention.rawInput).toBe(draft.rawInput);
    expect(intention.number).toBe(1);
  });

  it("numbers continue from the board, not from one", () => {
    const b = board({
      intentions: [{ id: "x", number: 7 } as never],
    });
    const { intention } = applySaveDraft(b, draft, {}, ids, 100);
    expect(intention.number).toBe(8);
  });

  it("a converted action retires only at save", () => {
    const b = board({
      actions: [{ id: "a1", text: "the source action", done: false, at: 1 } as never],
    });
    const out = applySaveDraft(b, draft, { pendingSource: "a1" }, ids, 100);
    expect(out.board.actions).toHaveLength(0);
    /* And without the conversion origin, actions are untouched. */
    const kept = applySaveDraft(b, draft, {}, ids, 100);
    expect(kept.board.actions).toHaveLength(1);
  });

  it("a capture-born draft writes its ledger entry; a conversion writes none", () => {
    const fromCapture = applySaveDraft(
      board(),
      draft,
      { capture: { raw: draft.rawInput, source: "dictated" as never, via: "groq" } },
      ids,
      100
    );
    expect(fromCapture.board.ledger).toHaveLength(1);
    const entry = fromCapture.board.ledger![0];
    expect(entry.raw).toBe(draft.rawInput);
    expect(entry.clean).toBe(draft.expandedIntention);
    expect(entry.targetId).toBe("int1");

    const conversion = applySaveDraft(board(), draft, {}, ids, 100);
    expect(conversion.board.ledger ?? []).toHaveLength(0);
  });

  it("carries every field the Board declares", () => {
    const b = board({
      wraps: [{ day: "2026-08-29", text: "short", at: 5 }] as never,
      historyEpoch: 2,
    });
    const out = applySaveDraft(b, draft, {}, ids, 100).board as unknown as Record<string, unknown>;
    for (const key of Object.keys(EMPTY)) {
      expect(out[key], `save dropped Board.${key}`).toBeDefined();
    }
  });
});
