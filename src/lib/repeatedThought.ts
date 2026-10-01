import type { Board } from "./model";
import type { Suggestion } from "./boardOps";

/** Words only: case, punctuation and spacing never make a thought new. */
const words = (text: string) =>
  text.toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * A thought that just landed in a Thread already holding the same words.
 *
 * Deliberately literal. Shared keywords once flagged "the undo button works
 * now" as a copy of "I want an undo button", so this matches only the same
 * words: identical, or wholly contained (six words or more) in an older
 * fragment of that Thread, or the other way round. Meaning-level repeats stay
 * Tidy's to find.
 */
export function repeatedThought(before: Board, after: Board, threadIds: string[]): Suggestion | null {
  for (const threadId of threadIds) {
    const thread = after.threads.find((item) => item.id === threadId);
    const older = before.threads.find((item) => item.id === threadId)?.frags ?? [];
    if (!thread || !older.length) continue;
    const known = new Set(older.map((frag) => frag.id));
    for (const frag of thread.frags.filter((item) => !known.has(item.id))) {
      const next = words(frag.text);
      if (!next) continue;
      const long = next.split(" ").length >= 6;
      const copy = older.find((old) => {
        const prior = words(old.text);
        return prior === next || (long && (prior.includes(next) || (prior.split(" ").length >= 6 && next.includes(prior))));
      });
      if (copy) return {
        kind: "duplicate",
        targetId: thread.id,
        targetName: thread.name,
        reason: "The same words are already in this thread.",
        sourceId: thread.id,
        sourceKind: "thread",
        sourceFragId: frag.id,
      };
    }
  }
  return null;
}
