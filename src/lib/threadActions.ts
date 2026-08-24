import type { Action, Board, Thread } from "./model";
import { sharedPhrase } from "./related";

/**
 * The actions that belong with a thread.
 *
 * Two ways in. Provenance: a "both" capture, a taken next step or an
 * extraction created the action and the thread-side of the same moment,
 * and the action carries `threadId` (older ones are recovered through the
 * ledger's both entries). And subject: an open action that shares a real
 * phrase — two content words or more, the same bar Tidy's fold uses — with
 * what the thread actually says. Provenance alone looked like no
 * intelligence at all on a board whose actions mostly predate the field;
 * the subject match is what makes the list feel like it was read.
 */
export function actionsForThread(
  board: Board,
  thread: Thread
): { open: Action[]; done: Action[] } {
  const vouched = new Set<string>();
  for (const e of board.ledger ?? []) {
    if (e.kind === "both" && e.targetId === thread.id && !e.undone) {
      if (e.clean) vouched.add(e.clean.trim());
    }
  }
  const threadText = [
    thread.name,
    thread.summary,
    ...thread.frags.map((f) => f.text),
  ]
    .filter(Boolean)
    .join(" ");

  const isMine = (a: Action) =>
    a.threadId === thread.id ||
    (!a.threadId && !!a.src && vouched.has(a.src.trim()));
  /* An action that names another thread as home is never borrowed. */
  const isRelated = (a: Action) =>
    !a.done &&
    (!a.threadId || a.threadId === thread.id) &&
    sharedPhrase(`${a.text} ${a.src ?? ""}`, threadText).split(" ").filter(Boolean)
      .length >= 2;

  const newestFirst = (x: Action, y: Action) => y.at - x.at;
  const seen = new Set<string>();
  const take = (list: Action[]) =>
    list.filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true)));

  const mine = board.actions.filter(isMine);
  const related = board.actions.filter((a) => !isMine(a) && isRelated(a));
  return {
    open: take(
      [...mine.filter((a) => !a.done), ...related].sort(newestFirst)
    ),
    done: mine.filter((a) => a.done).sort(newestFirst),
  };
}
