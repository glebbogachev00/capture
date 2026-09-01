import type { Board, Frag, Thread } from "./model";
import { applyActionDone } from "./actionOps";
import { threadHoldsNote } from "./organize";
import { isRefile, refileRule } from "./refiled";

/**
 * What editing, deleting, moving, and splitting a single note does to the
 * board — pure math, one function per gesture, each returning null when
 * the gesture has nothing to do.
 *
 * The null is not a convenience; each one is a shipped or near-shipped
 * incident standing still:
 *
 *   - An edit that changed nothing used to spend a model call and a push
 *     saying so.
 *   - A fast double-tap on delete consumed the note twice: the second run
 *     re-committed and re-summarised a board that had not changed.
 *   - A move whose destination had just been merged away (by an untangle
 *     accepted on the other device) must do nothing, not file the note
 *     into a thread that no longer exists.
 *
 * The rules the shapes carry: a thread with nothing left in it is just a
 * name and is removed; a moved note lands in time order, not at the end;
 * a note moved out within minutes of landing teaches the sorter a refile
 * lesson (the strongest signal the app gets); and a stale typo-fix may
 * only land on the exact text it proofread — never on a newer edit.
 */

/** Replace a note's text. Null when nothing changes — or, with `ifTextIs`,
    when the note no longer reads as the text the caller checked (the
    stale-proofread guard). */
export function applyFragEdit(
  board: Board,
  threadId: string,
  fragId: string,
  text: string,
  ifTextIs?: string
): Board | null {
  const frag = board.threads
    .find((t) => t.id === threadId)
    ?.frags.find((f) => f.id === fragId);
  if (!frag) return null;
  if (frag.text === text) return null;
  if (ifTextIs !== undefined && frag.text !== ifTextIs) return null;
  return {
    ...board,
    threads: board.threads.map((t) =>
      t.id === threadId
        ? {
            ...t,
            frags: t.frags.map((f) => (f.id === fragId ? { ...f, text } : f)),
          }
        : t
    ),
  };
}

export type FragDelete = {
  board: Board;
  /** The note was the last one, so its thread went with it. */
  removedThread: boolean;
  /** The images the note carried, for the caller to drop from storage. */
  imgs: string[];
};

export function applyFragDelete(
  board: Board,
  threadId: string,
  fragId: string
): FragDelete | null {
  const target = board.threads.find((t) => t.id === threadId);
  const frag = target?.frags.find((f) => f.id === fragId);
  if (!target || !frag) return null;
  const remaining = target.frags.filter((f) => f.id !== fragId);
  if (!remaining.length) {
    return {
      board: {
        ...board,
        threads: board.threads.filter((t) => t.id !== threadId),
      },
      removedThread: true,
      imgs: frag.imgs ?? [],
    };
  }
  return {
    board: {
      ...board,
      threads: board.threads.map((t) =>
        t.id === threadId ? { ...t, frags: remaining } : t
      ),
    },
    removedThread: false,
    imgs: frag.imgs ?? [],
  };
}

export type FragMove = {
  board: Board;
  /** The source thread was emptied and removed. */
  emptied: boolean;
  /** The refile lesson to record, when the move is the sorter being told
      it was wrong — null for an old note simply being reorganised. */
  lesson: string | null;
  /** The words that moved, for the correction record. */
  movedText: string;
  toName: string;
  fromName: string;
};

export function applyFragMove(
  board: Board,
  fromId: string,
  fragId: string,
  toId: string,
  now: number
): FragMove | null {
  const from = board.threads.find((t) => t.id === fromId);
  const frag = from?.frags.find((f) => f.id === fragId);
  const to = board.threads.find((t) => t.id === toId);
  if (!from || !frag || !to || fromId === toId) return null;

  const remaining = from.frags.filter((f) => f.id !== fragId);
  const emptied = remaining.length === 0;

  let threads = board.threads.map((t) =>
    t.id === toId
      ? { ...t, frags: [...t.frags, frag].sort((a, b) => a.at - b.at) }
      : t
  );
  threads = emptied
    ? threads.filter((t) => t.id !== fromId)
    : threads.map((t) => (t.id === fromId ? { ...t, frags: remaining } : t));

  const lesson = isRefile(frag.at, now)
    ? refileRule(
        frag.text,
        to.name,
        [to.name, to.summary, ...to.frags.map((f) => f.text)].join(" ")
      )
    : null;

  return {
    board: { ...board, threads },
    emptied,
    lesson,
    movedText: frag.text,
    toName: to.name,
    fromName: from.name,
  };
}

export type FragSplit = {
  board: Board;
  /** The new thread, first in the list so it is where the eye lands. */
  freshId: string;
  emptied: boolean;
};

export function applyFragSplit(
  board: Board,
  fromId: string,
  fragId: string,
  mkId: () => string
): FragSplit | null {
  const from = board.threads.find((t) => t.id === fromId);
  const frag = from?.frags.find((f) => f.id === fragId);
  if (!from || !frag) return null;

  const fresh: Thread = {
    id: mkId(),
    name: frag.text.split(/\s+/).slice(0, 5).join(" "),
    summary: "",
    frags: [frag],
  };
  const remaining = from.frags.filter((f) => f.id !== fragId);
  const emptied = remaining.length === 0;
  const threads: Thread[] = [
    fresh,
    ...(emptied
      ? board.threads.filter((t) => t.id !== fromId)
      : board.threads.map((t) =>
          t.id === fromId ? { ...t, frags: remaining } : t
        )),
  ];
  return { board: { ...board, threads }, freshId: fresh.id, emptied };
}

export type FragResolve = {
  board: Board;
  /** The open action born from this note, ticked in the same gesture —
      null when the note had no task twin. */
  tickedActionText: string | null;
};

/**
 * Label a note resolved — the answer to "a lot of things in there are
 * already done": the note STAYS in its thread as the record, the label
 * says the state, and an agent reading the board can finally tell done
 * from still-open. If an open action was born from this very note (same
 * words, same thread), it is ticked in the same gesture — one decision,
 * one result. Null when the note is gone or already labeled: a double
 * tap must not re-commit, and un-resolving is an edit, not a gesture.
 */
export function applyFragResolve(
  board: Board,
  threadId: string,
  fragId: string,
  now: number
): FragResolve | null {
  const thread = board.threads.find((t) => t.id === threadId);
  const frag = thread?.frags.find((f) => f.id === fragId);
  if (!thread || !frag || frag.resolvedAt) return null;

  const labeled: Board = {
    ...board,
    threads: board.threads.map((t) =>
      t.id === threadId
        ? {
            ...t,
            frags: t.frags.map((f) =>
              f.id === fragId ? { ...f, resolvedAt: now, updatedAt: now } : f
            ),
          }
        : t
    ),
  };

  const twin = board.actions.find(
    (a) =>
      !a.done &&
      a.threadId === threadId &&
      threadHoldsNote([frag], a.text, a.src)
  );
  if (!twin) return { board: labeled, tickedActionText: null };
  const done = applyActionDone(labeled, twin.id, now);
  return done
    ? { board: done.board, tickedActionText: twin.text }
    : { board: labeled, tickedActionText: null };
}

/** Take the label back off — mislabeling must be as cheap to undo as it
    was to apply. Null when the note is gone or was never labeled. */
export function applyFragUnresolve(
  board: Board,
  threadId: string,
  fragId: string,
  now: number
): Board | null {
  const frag = board.threads
    .find((t) => t.id === threadId)
    ?.frags.find((f) => f.id === fragId);
  if (!frag || !frag.resolvedAt) return null;
  return {
    ...board,
    threads: board.threads.map((t) =>
      t.id === threadId
        ? {
            ...t,
            frags: t.frags.map((f) =>
              f.id === fragId
                ? { ...f, resolvedAt: undefined, updatedAt: now }
                : f
            ),
          }
        : t
    ),
  };
}
