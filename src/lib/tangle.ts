/**
 * Two threads that keep being confused for each other.
 *
 * Measured on a real board, one pair of threads accounted for a third of
 * every misfiling: the same kind of thought went to "Capture." one day and
 * "Bugs, Issues and Additions" the next. Three different engines — the free
 * model chain, a much stronger model, and nearest-neighbour over meaning —
 * all failed on that pair in the same way, which is the signature of a
 * distinction that does not exist rather than one nobody has found. No
 * amount of sorting intelligence can learn a rule the person does not have.
 *
 * So this does not try to sort better. It notices the pattern and says so,
 * because the fix belongs on the board: some of what is in one thread would
 * be better off in the other, and only the person can say.
 *
 * The evidence is the board's own history. Every capture recorded where the
 * engine filed it; if that fragment lives somewhere else today, the person
 * moved it, and the pair (filed → moved to) is a confusion they had to
 * correct by hand. Counting those pairs needs nothing new to be recorded and
 * works on a board that has been in use for months.
 *
 * Note this deliberately does NOT propose merging the two threads. A thread
 * that collects what is broken holds plenty that has nothing to do with the
 * app it keeps being confused with; folding them together would bury it. The
 * question is only ever which FRAGMENTS sit in the wrong one.
 */

import type { Board } from "./model";

/** Below this a pair is coincidence, not a pattern. */
export const MIN_CONFUSIONS = 3;

export type ConfusedPair = {
  /** Where the engine kept filing it. */
  fromId: string;
  fromName: string;
  /** Where the person kept moving it to. */
  toId: string;
  toName: string;
  /** How many times they made that correction. */
  times: number;
  /** The most recent correction, so a pair that has stopped happening can
      be ranked below one that is still happening. */
  lastAt: number;
};

/**
 * Pairs of threads this person keeps correcting between, worst first.
 *
 * Only counts corrections in one direction at a time: A→B and B→A are
 * separate entries, because "things you file as A really belong in B" is a
 * different observation from its reverse, and a thread pair can easily leak
 * mostly one way.
 */
export function confusedPairs(
  board: Board,
  min: number = MIN_CONFUSIONS
): ConfusedPair[] {
  const names = new Map(board.threads.map((t) => [t.id, t.name]));
  /* Where each fragment lives now — the person's own final answer. */
  const homeOf = new Map<string, string>();
  for (const t of board.threads)
    for (const f of t.frags ?? []) homeOf.set(f.id, t.id);

  const seen = new Map<string, ConfusedPair>();
  for (const e of board.ledger ?? []) {
    if (e.undone) continue;
    if (e.kind !== "thread" && e.kind !== "both") continue;
    if (!e.targetFragId) continue;
    const to = homeOf.get(e.targetFragId);
    /* No current home means the fragment was deleted, which says nothing
       about where it belonged. */
    if (!to || to === e.targetId) continue;
    /* Both ends have to still exist for the pair to be actionable. */
    if (!names.has(e.targetId) || !names.has(to)) continue;

    const key = `${e.targetId}>${to}`;
    const prev = seen.get(key);
    if (prev) {
      prev.times += 1;
      prev.lastAt = Math.max(prev.lastAt, e.at);
      continue;
    }
    seen.set(key, {
      fromId: e.targetId,
      fromName: names.get(e.targetId)!,
      toId: to,
      toName: names.get(to)!,
      times: 1,
      lastAt: e.at,
    });
  }

  return [...seen.values()]
    .filter((p) => p.times >= min)
    .sort((a, b) => b.times - a.times || b.lastAt - a.lastAt);
}

/**
 * The fragments worth asking about.
 *
 * Given a confused pair and a judgement of which fragments in one thread
 * really belong in the other, this is what the proposal will carry. The
 * judging itself is not done here — it needs to read meaning, which is a
 * model's job — so this stays pure and the caller supplies the verdict.
 */
export function tangleProposalId(pair: ConfusedPair): string {
  return `untangle:${pair.fromId}:${pair.toId}`;
}

/** How the observation reads to the person: plain, and countable. */
export function tangleReason(pair: ConfusedPair): string {
  const n = pair.times;
  return `you have moved ${n} ${n === 1 ? "thing" : "things"} from ${pair.fromName} to ${pair.toName}`;
}
