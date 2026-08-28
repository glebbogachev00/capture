/**
 * Which threads Tidy still needs to read.
 *
 * Reading the whole board takes three to five minutes, and that is not a
 * tuning problem: a board of nineteen threads is around 15,000 tokens
 * against a per-minute allowance of 8,000, so two minutes is the floor
 * before the model thinks at all. The only way to make it quicker is to
 * ask about less.
 *
 * Almost always, less is nearly everything. A person captures one thought
 * and taps Tidy; eighteen of their nineteen threads are exactly as they
 * were when it last read them, and re-reading those buys nothing but the
 * wait. So the reading is remembered per thread, and only the threads that
 * actually changed are sent again.
 *
 * What this gives up: a claim that spans a changed thread and an unchanged
 * one, where the unchanged side was never in the request. The paced passes
 * already gave that up — a board is read in groups of five — so this costs
 * nothing that was still being paid for.
 */

import type { Board, Thread } from "./model";

/** What a thread looks like to Tidy: its name, and every note in it. */
export function threadFingerprint(t: Thread): string {
  const frags = (t.frags ?? [])
    .map((f) => `${f.id}:${f.at}:${f.text.length}`)
    .join(",");
  return `${t.name}|${(t.summary ?? "").length}|${frags}`;
}

/** The actions and intentions, which ride with every request anyway. */
export function restFingerprint(board: Board): string {
  const acts = board.actions
    .map((a) => `${a.id}:${a.text.length}:${a.done ? 1 : 0}`)
    .join(",");
  const ints = board.intentions.map((i) => i.id).join(",");
  return `${acts}|${ints}`;
}

export type TidyRead = {
  /** Fingerprint per thread id, as last read. */
  threads: Record<string, string>;
  rest: string;
};

export type TidyPlan = {
  /** Threads to send. Empty when nothing has changed. */
  send: Thread[];
  /** Ids whose previous proposals are still good. */
  unchanged: Set<string>;
  /** Nothing at all has changed — the previous reading stands as it is. */
  reuseEverything: boolean;
  /** What to remember once the reading comes back. */
  read: TidyRead;
};

/**
 * Work out what to ask about.
 *
 * With no previous reading, everything is sent — the first Tidy on a board
 * is the slow one and there is no way around it.
 */
export function planTidy(board: Board, last: TidyRead | null): TidyPlan {
  const read: TidyRead = { threads: {}, rest: restFingerprint(board) };
  for (const t of board.threads) read.threads[t.id] = threadFingerprint(t);

  if (!last) {
    return {
      send: board.threads,
      unchanged: new Set(),
      reuseEverything: false,
      read,
    };
  }

  const unchanged = new Set<string>();
  const send: Thread[] = [];
  for (const t of board.threads) {
    if (last.threads[t.id] === read.threads[t.id]) unchanged.add(t.id);
    else send.push(t);
  }

  /* A changed action can produce a claim about any thread — folding one in,
     extracting one out — so when the actions move, the thread proposals
     that mention them cannot be trusted either. Rare enough to be worth
     the honest answer: read it all again. */
  const restMoved = last.rest !== read.rest;
  if (restMoved) {
    return { send: board.threads, unchanged: new Set(), reuseEverything: false, read };
  }

  return {
    send,
    unchanged,
    reuseEverything: send.length === 0,
    read,
  };
}

/**
 * Which remembered proposals survive.
 *
 * A proposal belongs to the threads it would change. If all of them were
 * left alone, the claim still stands; if any was re-read, the fresh reading
 * replaces it — keeping the old one would show a claim about a note that
 * may no longer be there.
 *
 * Ids that are not threads at all (actions, intentions) are ignored here.
 * Those are only ever re-read wholesale, and a change among them sends the
 * whole board back anyway, so they cannot be stale by the time this runs.
 */
export function keepProposals<
  P extends { sourceThreadId?: string; sourceId?: string; targetId?: string },
>(previous: P[], unchanged: Set<string>, allThreadIds: Set<string>): P[] {
  return previous.filter((p) => {
    const threadsTouched = [p.sourceThreadId, p.sourceId, p.targetId]
      .filter((v): v is string => !!v)
      .filter((id) => allThreadIds.has(id));
    /* A claim with a foot in a re-read thread is dropped rather than
       half-trusted. One that names a thread which no longer exists is
       dropped too: `allThreadIds` will not contain it, so it cannot be in
       `unchanged` either. */
    return threadsTouched.every((id) => unchanged.has(id));
  });
}
