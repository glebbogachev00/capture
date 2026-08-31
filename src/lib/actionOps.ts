import type { Action, Board, Thread } from "./model";
import { threadHoldsNote } from "./organize";
import { isRefile, refileRule } from "./refiled";

/**
 * What ticking, removing, and re-homing an action does to the board —
 * pure math, null when there is nothing to do, mirroring lib/fragOps.
 *
 * The rules these shapes carry, each with a history:
 *
 *   - A tick removes the row but KEEPS the fact: the completion receipt is
 *     append-only and keyed by the action's own id. Before it existed, a
 *     day of finishing things left the same trace as a day of none.
 *   - Folding an action into a thread can never duplicate the note.
 *     Extraction leaves the note in its thread, so an action extracted
 *     from a thread folds back into the very fragment it came from — the
 *     task is retired, nothing is appended. This is the safety net that
 *     lets approve-all run whatever a stale proposal or cached AI pass
 *     says.
 *   - A fold within minutes of landing is the sorter being told "that was
 *     a note, not a task" — the same correction as a re-filed fragment,
 *     from the other direction, and it writes the same kind of lesson.
 *   - Images are handed back, never dropped here: the old order deleted
 *     photos first, and a failed commit left the action alive with its
 *     pictures gone.
 */

export type ActionDone = {
  board: Board;
  /** The images the row carried, for the caller to drop AFTER the board
      commits. */
  imgs: string[];
};

/** Tick an action off. Null when the row is already gone — a fast
    double-tap must not re-commit or write a second receipt. */
export function applyActionDone(
  board: Board,
  id: string,
  now: number
): ActionDone | null {
  const a = board.actions.find((x) => x.id === id);
  if (!a) return null;
  return {
    board: {
      ...board,
      actions: board.actions.filter((x) => x.id !== id),
      completions: [
        ...(board.completions ?? []),
        { id: a.id, text: a.text, at: now, threadId: a.threadId },
      ],
    },
    imgs: a.imgs ?? [],
  };
}

export type ActionToThread = {
  board: Board;
  /** The new thread, first in the list so it is where the eye lands. */
  threadId: string;
};

/** Turn an action into a thread of its own. The fragment keeps the
    ORIGINAL words (src), not the rewritten task text. */
export function applyActionToNewThread(
  board: Board,
  actionId: string,
  mkId: () => string
): ActionToThread | null {
  const a = board.actions.find((x) => x.id === actionId);
  if (!a) return null;
  const t: Thread = {
    id: mkId(),
    name: a.text.split(" ").slice(0, 5).join(" "),
    summary: "",
    frags: [{ id: mkId(), at: a.at, text: a.src || a.text, imgs: a.imgs || [] }],
  };
  return {
    board: {
      ...board,
      actions: board.actions.filter((x) => x.id !== actionId),
      threads: [t, ...board.threads],
    },
    threadId: t.id,
  };
}

export type ActionFold = {
  board: Board;
  /** The thread already held the note — task retired, nothing appended. */
  already: boolean;
  /** The refile lesson to record, when the fold corrects a fresh sort. */
  lesson: string | null;
  /** The words that moved, for the correction record. */
  foldedText: string;
  threadName: string;
};

export function applyActionFold(
  board: Board,
  actionId: string,
  threadId: string,
  now: number,
  mkId: () => string
): ActionFold | null {
  const a = board.actions.find((x: Action) => x.id === actionId);
  const t = board.threads.find((x) => x.id === threadId);
  if (!a || !t) return null;

  const note = a.src || a.text;
  const already = threadHoldsNote(t.frags, note, a.text);
  const lesson = isRefile(a.at, now)
    ? refileRule(
        note,
        t.name,
        [t.name, t.summary, ...t.frags.map((f) => f.text)].join(" ")
      )
    : null;

  return {
    board: {
      ...board,
      actions: board.actions.filter((x) => x.id !== actionId),
      threads: already
        ? board.threads
        : board.threads.map((x) =>
            x.id === threadId
              ? {
                  ...x,
                  frags: [
                    ...x.frags,
                    { id: mkId(), at: a.at, text: note, imgs: a.imgs || [] },
                  ].sort((p, q) => p.at - q.at),
                }
              : x
          ),
    },
    already,
    lesson,
    foldedText: note,
    threadName: t.name,
  };
}
