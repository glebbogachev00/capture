import type { Action, Board } from "./model";

/**
 * The actions a thread gave rise to.
 *
 * A "both" capture files a task and a layer of thinking in one breath; a
 * taken next step turns a thread's own reading into a task; an extraction
 * lifts a task out of a note. In every case the action and the thread are
 * two halves of one moment — and until now the board forgot that the
 * moment happened. New actions carry `threadId`; for actions from before
 * the field existed, the ledger still remembers: a "both" entry names the
 * thread it landed on, and the actions it made carry the capture's cleaned
 * text as their `src`.
 */
export function actionsFromThread(
  board: Board,
  threadId: string
): { open: Action[]; done: Action[] } {
  /* What the old ledger can vouch for: the cleaned text of every "both"
     capture that landed on this thread. */
  const vouched = new Set<string>();
  for (const e of board.ledger ?? []) {
    if (e.kind === "both" && e.targetId === threadId && !e.undone) {
      if (e.clean) vouched.add(e.clean.trim());
    }
  }
  const mine = board.actions.filter(
    (a) =>
      a.threadId === threadId ||
      (!a.threadId && !!a.src && vouched.has(a.src.trim()))
  );
  const newestFirst = (x: Action, y: Action) => y.at - x.at;
  return {
    open: mine.filter((a) => !a.done).sort(newestFirst),
    done: mine.filter((a) => a.done).sort(newestFirst),
  };
}
