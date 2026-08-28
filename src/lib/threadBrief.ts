import type { Thread } from "./model";

/**
 * What the sorter is told about each thread.
 *
 * Routing is a choice between every thread on the board, and the only
 * description each one gets is this. It used to be a flat 160 characters
 * of summary — about a sentence and a half — which on a board of
 * seventeen threads meant choosing between seventeen near-identical
 * openers, and a capture that merely mentioned a thread's subject in
 * passing could win it. A summary is already the thread's own account of
 * itself; the sorter should read enough of it to tell threads apart.
 *
 * The whole set is budgeted rather than each thread capped, so a small
 * board gets generous descriptions and a large one still fits: every
 * capture pays for this context on every sort.
 */
export const BRIEF_BUDGET = 5000;
const MIN = 200;
const MAX = 700;

export function briefLength(threadCount: number): number {
  if (threadCount <= 0) return MAX;
  const share = Math.floor(BRIEF_BUDGET / threadCount);
  return Math.max(MIN, Math.min(MAX, share));
}

/** Trim at a sentence end where there is one, so the model never reads a
    description that stops mid-clause and implies something untrue. */
export function brief(summary: string | undefined, limit: number): string {
  const text = (summary ?? "").trim();
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "));
  return stop > limit * 0.5 ? cut.slice(0, stop + 1) : cut.trimEnd() + "…";
}

export function threadBriefs(
  threads: Thread[]
): { id: string; name: string; about: string }[] {
  const limit = briefLength(threads.length);
  return threads.map((t) => ({
    id: t.id,
    name: t.name,
    /* The boundary first, because it is the part that decides. A summary
       says what the thread contains, which two threads about the same
       subject will say almost identically; the boundary says what belongs,
       which is the only question being asked here. Threads summarised
       before boundaries existed have none, and fall back to the summary
       alone exactly as before. */
    about: t.belongs
      ? `${t.belongs.trim()}\n\n${brief(t.summary, Math.max(MIN, limit - t.belongs.length))}`
      : brief(t.summary, limit),
  }));
}
