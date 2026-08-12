import type { Board } from "./model";

/**
 * What a sync actually brought in.
 *
 * The merge has always known this and never said it, so a successful sync
 * looked identical whether nothing changed or three notes arrived from the
 * other device. Counting the items the merged board has that the local one
 * did not turns silence into a sentence.
 *
 * Only ADDITIONS are counted. A sync that brings edits or deletions says
 * nothing: "2 notes arrived" is news, "something somewhere changed" is
 * noise, and the board already shows edits where they happened.
 */

export type Arrived = { actions: number; frags: number; threads: number };

const ids = (xs: { id: string }[]) => new Set(xs.map((x) => x.id));

export function arrivedIn(before: Board, after: Board): Arrived {
  const hadActions = ids(before.actions);
  const hadThreads = ids(before.threads);
  const hadFrags = new Set(
    before.threads.flatMap((t) => (t.frags || []).map((f) => f.id))
  );
  return {
    actions: after.actions.filter((a) => !hadActions.has(a.id)).length,
    threads: after.threads.filter((t) => !hadThreads.has(t.id)).length,
    frags: after.threads
      .flatMap((t) => t.frags || [])
      .filter((f) => !hadFrags.has(f.id)).length,
  };
}

/** One plain sentence, or null when nothing arrived worth saying. */
export function arrivedNote(a: Arrived): string | null {
  const parts: string[] = [];
  const plural = (n: number, one: string, many: string) =>
    `${n} ${n === 1 ? one : many}`;
  if (a.actions) parts.push(plural(a.actions, "action", "actions"));
  /* A brand-new thread arrives with its notes; naming both would double-count
     the same words, so a new thread speaks for its fragments. */
  if (a.threads) parts.push(plural(a.threads, "thread", "threads"));
  else if (a.frags) parts.push(plural(a.frags, "note", "notes"));
  if (!parts.length) return null;
  const list =
    parts.length === 1
      ? parts[0]
      : parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1];
  return `${list} arrived from your other device.`;
}
