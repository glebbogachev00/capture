import { withLedger, type CaptureSource } from "./ledger";
import type { Board, Intention } from "./model";
import { nextNumber } from "./model";

/**
 * What saving a reviewed intention draft does to a board.
 *
 * Pure, for the same reason the other seams are: this is where the rules
 * live, and rules inlined in a 4,000-line hook can only be tested by
 * reading them. The rules here:
 *
 *   - The intention takes the next free number and the FULL rawInput rides
 *     with it — the person's own words are part of the record, not just
 *     the condensed reading of them (losing them was a shipped complaint:
 *     "a lot of things I said got lost").
 *   - A draft opened by CONVERTING an action retires that action only now,
 *     at save — discarding the draft keeps it. Its photos stay on disk,
 *     because Undo can bring the action back and a restored action
 *     pointing at deleted bytes is worse than a stray picture.
 *   - A draft opened by a CAPTURE writes the ledger entry the capture
 *     earned: what was said, what it became, and which model read it.
 */

export type SaveDraftInput = {
  rawInput: string;
  expandedIntention: string;
  recommendedActions: string[];
  counterIntentions: string[];
};

export type DraftOrigin = {
  /** The action this draft was converted from, if any — retired at save. */
  pendingSource?: string | null;
  /** The capture that opened this draft, if any — ledgered at save. */
  capture?: { raw: string; source: CaptureSource; via?: string } | null;
};

export function applySaveDraft(
  board: Board,
  draft: SaveDraftInput,
  origin: DraftOrigin,
  ids: { intentionId: string; ledgerId: string },
  at: number
): { board: Board; intention: Intention } {
  const intention: Intention = {
    id: ids.intentionId,
    number: nextNumber(board.intentions),
    rawInput: draft.rawInput,
    expandedIntention: draft.expandedIntention,
    recommendedActions: draft.recommendedActions,
    counterIntentions: draft.counterIntentions,
    at,
    updatedAt: at,
  };
  let next: Board = {
    ...board,
    intentions: [intention, ...board.intentions],
  };
  if (origin.pendingSource) {
    next = {
      ...next,
      actions: board.actions.filter((a) => a.id !== origin.pendingSource),
    };
  }
  if (origin.capture) {
    next = withLedger(next, {
      id: ids.ledgerId,
      at,
      raw: origin.capture.raw,
      clean: draft.expandedIntention,
      kind: "intention",
      source: origin.capture.source,
      targetId: intention.id,
      modelVia: origin.capture.via,
    });
  }
  return { board: next, intention };
}
