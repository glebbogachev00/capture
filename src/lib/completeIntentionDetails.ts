import type { Board } from "./model";
import { ownedFetch as fetch } from "./ownership";
import { requestIntentionExpansion } from "./resortOps";

/** Fill new mixed-capture Intentions without delaying filing or changing their wording. */
export async function completeIntentionDetails(
  ids: string[],
  currentBoard: () => Board,
  commit: (build: (board: Board) => Board | null) => Promise<unknown>,
  active: () => boolean,
) {
  for (const id of ids) {
    if (!active()) return;
    const expected = currentBoard().intentions.find(item => item.id === id);
    if (!expected || expected.recommendedActions.length || expected.counterIntentions.length) continue;
    const result = await requestIntentionExpansion(
      fetch, expected.rawInput, currentBoard().principles, currentBoard,
      undefined, undefined, AbortSignal.timeout(55_000),
    );
    if (!result || !active()) return;
    const { recommendedActions, counterIntentions } = result.draft;
    if (!Array.isArray(recommendedActions) || !Array.isArray(counterIntentions) ||
        ![...recommendedActions, ...counterIntentions].every(item => typeof item === "string")) return;
    await commit(board => {
      const current = board.intentions.find(item => item.id === id);
      // Undo, deletion, edits, and newer remote changes win over late generation.
      if (!active() || !current || JSON.stringify(current) !== JSON.stringify(expected)) return null;
      return { ...board, intentions: board.intentions.map(item => item.id === id
        ? { ...item, recommendedActions, counterIntentions, updatedAt: Date.now() }
        : item) };
    });
  }
}
