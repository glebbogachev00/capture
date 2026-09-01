import type { Action, Board, Thread } from "./model";
import { spokenText } from "./caption";
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
/** A finished item as the thread shows it — enough for a count, a
    checkbox line, and an agent reading the share. */
export type DoneItem = { id: string; text: string; at: number };

export function actionsForThread(
  board: Board,
  thread: Thread
): { open: Action[]; done: DoneItem[] } {
  const vouched = new Set<string>();
  for (const e of board.ledger ?? []) {
    if (e.kind === "both" && e.targetId === thread.id && !e.undone) {
      if (e.clean) vouched.add(e.clean.trim());
    }
  }
  /* Without the photo captions — see spokenText. A screenshot of the board
     filed into a thread quotes other actions verbatim, and this list then
     claimed them. */
  const threadText = spokenText(
    [thread.name, thread.summary, ...thread.frags.map((f) => f.text)]
      .filter(Boolean)
      .join(" ")
  );

  /* A restore can bring an action across without the thread it named —
     its own thread already existed here, or was never in the backup. A
     link that resolves to nothing is not a link, so the action is free to
     be claimed by subject like any unattached one. */
  const homed = (a: Action) =>
    a.threadId && board.threads.some((t) => t.id === a.threadId)
      ? a.threadId
      : undefined;

  const isMine = (a: Action) =>
    homed(a) === thread.id ||
    (!homed(a) && !!a.src && vouched.has(a.src.trim()));
  /* A shared PHRASE, never a shared word.
     One telling word was tried and it is wrong. "Give the caul lilies to
     my girlfriend" attached itself to a thread about AI agents, because
     that thread mentioned ordering flowers for a girlfriend once: a single
     incidental word, rare enough to pass, and the action was borrowed into
     a place it had nothing to do with. The same board showed a portfolio
     errand under a bug tracker. The rarity gate cannot save this, and it
     got looser as the board grew, because `common` scaled with the item
     count — the bigger the board, the more words counted as rare.

     A thread that shows no actions is a small disappointment. A thread
     that shows someone else's is the app being wrong out loud, and that
     is the failure this list must not have. Two content words in a row,
     the same bar Tidy's fold uses. */

  /* An action that names another living thread as home is never borrowed. */
  const isRelated = (a: Action) => {
    if (a.done || homed(a)) return false;
    const run = sharedPhrase(spokenText(`${a.text} ${a.src ?? ""}`), threadText)
      .split(" ")
      .filter(Boolean);
    return run.length >= 2;
  };

  const newestFirst = (x: Action, y: Action) => y.at - x.at;
  const seen = new Set<string>();
  const take = (list: Action[]) =>
    list.filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true)));

  const mine = board.actions.filter(isMine);
  const related = board.actions.filter((a) => !isMine(a) && isRelated(a));
  /* The finished work, from the completion receipts. A tick REMOVES the
     action from the board (the receipt is the fact that survives), so
     until this read the done list was always empty — a thread with a week
     of finished work looked untouched, and an agent handed the share had
     no way to tell done from never-existed. That visibility is the point:
     "when I have a board the agent knows what was done and what to work
     on." */
  const ticked: DoneItem[] = (board.completions ?? [])
    .filter((c) => c.threadId === thread.id)
    .map((c) => ({ id: c.id, text: c.text, at: c.at }));
  return {
    open: take(
      [...mine.filter((a) => !a.done), ...related].sort(newestFirst)
    ),
    done: take(
      [...mine.filter((a) => a.done), ...ticked].sort(newestFirst)
    ),
  };
}
