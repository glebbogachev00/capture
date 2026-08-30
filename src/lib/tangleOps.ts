import type { Action, Board, Thread } from "./model";
import type { TangleProposal } from "./tangle";

/**
 * What accepting an untangle proposal does to a board.
 *
 * Pure, and extracted from the hook for a reason with two incidents behind
 * it. This is the code that decides whether a thread is merged away, which
 * notes move, and where the actions pointing at a deleted thread go — and
 * while it lived inline in useBoard it could only be tested by grepping its
 * own source. Both of its bugs shipped exactly that way: the review said
 * "Merge" while the board said "Moved 22", because the UI and the board
 * math counted different things and no test could hold the two together.
 *
 * The contract, in one place:
 *
 *   - The chosen fragments move to the destination thread, in time order.
 *   - Taking EVERY fragment absorbs the source thread: it stops existing,
 *     and the actions that remembered it follow the notes rather than
 *     pointing at nothing. A thread that was already empty is never
 *     absorbed — nobody agreed to that.
 *   - A partial move leaves the source thread standing, renamed only when
 *     the rename was accepted.
 *   - `takeAll` widens the move to every fragment in the source thread,
 *     not just the ones the judge listed — without it the merge was
 *     unreachable in practice, because the judge proposes the subset it is
 *     confident about.
 */

export type TangleOutcome = {
  board: Board;
  /** The source thread was emptied and absorbed. */
  emptied: boolean;
  /** How many fragments actually moved. */
  moved: number;
  /** What the notice should say. */
  notice: string;
};

export function applyTangleAccept(
  board: Board,
  t: TangleProposal,
  fragIds: string[],
  rename: boolean,
  takeAll = false
): TangleOutcome | null {
  const from = board.threads.find((x) => x.id === t.pair.fromId);
  const taking = new Set(
    takeAll ? (from?.frags ?? []).map((f) => f.id) : fragIds
  );
  const going = (from?.frags ?? []).filter((f) => taking.has(f.id));
  if (!going.length && !(rename && t.rename)) return null;

  const emptied =
    (from?.frags ?? []).length > 0 &&
    (from?.frags ?? []).every((f) => taking.has(f.id));

  const threads = board.threads
    .map((x: Thread) => {
      if (x.id === t.pair.fromId) {
        const left = x.frags.filter((f) => !taking.has(f.id));
        return {
          ...x,
          frags: left,
          ...(rename && t.rename ? { name: t.rename } : {}),
        };
      }
      if (x.id === t.pair.toId)
        return {
          ...x,
          frags: [...x.frags, ...going].sort((a, b) => a.at - b.at),
        };
      return x;
    })
    .filter((x) => !(emptied && x.id === t.pair.fromId));

  const actions = emptied
    ? board.actions.map((a: Action) =>
        a.threadId === t.pair.fromId ? { ...a, threadId: t.pair.toId } : a
      )
    : board.actions;

  const notice = emptied
    ? `Merged ${t.pair.fromName} into ${t.pair.toName} · ${going.length} ${
        going.length === 1 ? "note" : "notes"
      }`
    : `Moved ${going.length} to ${t.pair.toName}` +
      (rename && t.rename ? ` · renamed to ${t.rename}` : "");

  return { board: { ...board, threads, actions }, emptied, moved: going.length, notice };
}
