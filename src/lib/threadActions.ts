import type { Action, Board, Thread } from "./model";
import { contentWords, sharedPhrase } from "./related";

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
  /* How common each word is across the whole board. A two-word run is a
     strong signal but a rare one: on a real board of bug reports and
     project threads, an action and the thread it belongs to often share a
     single telling word and nothing else, and demanding a run meant the
     list came up empty exactly where it should have been useful. So one
     shared word counts too — as long as the board says that word is not
     everywhere. */
  const freq = new Map<string, number>();
  for (const w of contentWords(
    [
      ...board.actions.map((a) => `${a.text} ${a.src ?? ""}`),
      ...board.threads.map(
        (t) =>
          `${t.name} ${t.summary} ${t.frags.map((f) => f.text).join(" ")}`
      ),
    ].join(" ")
  ))
    freq.set(w, (freq.get(w) ?? 0) + 1);
  const items =
    board.actions.length + board.threads.length + board.intentions.length;
  const common = Math.max(3, Math.floor(items / 4));
  const threadWords = new Set(contentWords(threadText));

  /* An action that names another living thread as home is never borrowed. */
  const isRelated = (a: Action) => {
    if (a.done || homed(a)) return false;
    const mine = contentWords(`${a.text} ${a.src ?? ""}`);
    const run = sharedPhrase(`${a.text} ${a.src ?? ""}`, threadText)
      .split(" ")
      .filter(Boolean);
    if (run.length >= 2) return true;
    return mine.some(
      (w) => threadWords.has(w) && (freq.get(w) ?? 0) <= common
    );
  };

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
