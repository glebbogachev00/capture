/**
 * The daily wrap — what a day of capturing added up to.
 *
 * The board keeps what each capture BECAME. The ledger keeps how it got
 * there. The wrap is the third reading: what the day, taken whole, was
 * about. It is derived from the ledger rather than the board because the
 * board forgets — actions fade, threads rest — and a day that happened
 * should not become less true because its actions have since expired.
 *
 * A wrap is written once and never rewritten. Wednesday's wrap must not
 * quietly change when Thursday's captures land; a journal that edits its own
 * past entries is not a journal. That immutability is the whole reason wraps
 * are stored at all — "frozen" has to live somewhere.
 *
 * Stored wraps are also what make the interesting line possible. Everything
 * derivable from one day is arithmetic ("8 of 24 were bugs"). The line worth
 * reading is the one that needs history: "third day running on bugs". So the
 * last few wraps ride along to the model as context.
 */

import type { Board, Completion } from "./model";
import { dayKey } from "./record";
import type { CaptureEntry } from "./ledger";

const DAY_MS = 864e5;

/** A day with fewer captures than this has nothing to say about itself. */
export const MIN_CAPTURES = 3;
/** How many past wraps ride along as context for the cross-day line. */
export const HISTORY = 7;

/** The counted shape of one day, before any words are put to it. */
export type WrapStats = {
  /** Local calendar day, YYYY-MM-DD. */
  day: string;
  said: number;
  threadsMoved: number;
  actionsMade: number;
  intentions: number;
  /** Threads that took captures that day, busiest first. */
  threads: { name: string; n: number }[];
  /** First and last capture of the day, ms. */
  firstAt: number;
  lastAt: number;
  /** What was actually ticked off that day. */
  finished: { text: string; at: number }[];
  /** Times the day returned to its busiest thread, ms — the "you kept
      coming back to this" signal, which a single count cannot show. */
  returns: number[];
};

/** One frozen day. Append-only: written once, then only `seen` flips. */
export type DayWrap = {
  day: string;
  /** When the wrap was written, ms. */
  at: number;
  stats: WrapStats;
  /** The day in one sentence. */
  line: string;
  /** Two to four short readings, each a label and one punchy line. */
  insights: { k: string; v: string }[];
  /** One thing worth doing tomorrow. */
  tomorrow: string;
  /** Which model tier wrote it. */
  via?: string;
  /** Arrived and been dismissed. The wrap is kept; it just stops asking. */
  seen?: boolean;
};

/* The heat map buckets by the same local day, and had this first — days are
   the user's days, not Greenwich's. Re-exported so the wrap and the grid can
   never drift apart about where a midnight capture belongs. */
export { dayKey };

/** The ledger entries that count for a day: what was said, and still stands. */
function entriesFor(board: Board, day: string): CaptureEntry[] {
  return (board.ledger ?? [])
    .filter((e) => !e.undone && dayKey(e.at) === day)
    .sort((a, b) => a.at - b.at);
}

/**
 * Count a day from the ledger.
 *
 * Returns null when the day is too thin to wrap — three captures is the
 * floor, below which any summary is inventing significance.
 */
export function dayStats(board: Board, day: string): WrapStats | null {
  const es = entriesFor(board, day);
  /* Counted as utterances too: three destinations of one split thought is
     not three captures, and a day that thin has nothing to say about
     itself. */
  if (new Set(es.map((e) => e.captureId ?? e.id)).size < MIN_CAPTURES)
    return null;

  const names = new Map(board.threads.map((t) => [t.id, t.name]));
  /* A capture's targetId can outlive the thread it named — merged away,
     or removed. The fragment it left behind still knows where it lives, so
     try that before giving up. What cannot be named after both attempts is
     left out entirely: a row labelled "—" is not information, it is a hole
     with a bar chart next to it. */
  const fragHome = new Map<string, string>();
  for (const t of board.threads)
    for (const f of t.frags ?? []) fragHome.set(f.id, t.id);
  const homeOf = (e: CaptureEntry): string | null => {
    if (names.has(e.targetId)) return e.targetId;
    const viaFrag = e.targetFragId ? fragHome.get(e.targetFragId) : undefined;
    return viaFrag ?? null;
  };

  const byThread = new Map<string, number>();
  for (const e of es) {
    if (e.kind !== "thread" && e.kind !== "both") continue;
    const home = homeOf(e);
    if (!home) continue;
    byThread.set(home, (byThread.get(home) ?? 0) + 1);
  }
  const threads = [...byThread.entries()]
    .map(([id, n]) => ({ name: names.get(id) ?? "", n, id }))
    .filter((t) => t.name)
    .sort((a, b) => b.n - a.n);

  /* "Returns" are the times the day came back to its busiest thread. One
     visit is not a return, so a thread touched once contributes nothing. */
  const top = threads[0];
  const returns =
    top && top.n > 1
      ? es.filter((e) => homeOf(e) === top.id).map((e) => e.at)
      : [];

  /* Utterances, not destinations. A split capture writes one entry per
     thread it reached, so counting entries counted the same sentence twice —
     and could meet the three-capture floor on its own. */
  const utterances = new Set(es.map((e) => e.captureId ?? e.id)).size;

  return {
    day,
    finished: (board.completions ?? [])
      .filter((c) => dayKey(c.at) === day)
      .map((c) => ({ text: c.text, at: c.at })),
    said: utterances,
    threadsMoved: threads.length,
    actionsMade: es.filter((e) => e.kind === "action" || e.kind === "both")
      .length,
    intentions: es.filter((e) => e.kind === "intention").length,
    threads: threads.map(({ name, n }) => ({ name, n })),
    firstAt: es[0].at,
    lastAt: es[es.length - 1].at,
    returns,
  };
}

/**
 * Which day is owed a wrap, if any.
 *
 * The rule is deliberately one rule: yesterday's wrap arrives the next time
 * you open Capture. Not a timer, not a guess at when the day ended — the day
 * is over when a later day has begun. Days that were too thin are skipped
 * and never come back; days already wrapped are done.
 */
export function wrapDue(
  board: Board,
  wraps: DayWrap[],
  now: number
): string | null {
  const today = dayKey(now);
  /* Only ever yesterday. Anything older is gone for good, and deliberately:
     writing one wrap makes the board change, which runs this again, and
     without a floor the second pass finds the day before and the third the
     day before that — a first run on a full ledger would wrap every day in
     it, one model call each. It is also just the right product: after a
     week away you want yesterday, not a queue of seven. */
  const yesterday = dayKey(now - DAY_MS);
  const done = new Set(wraps.map((w) => w.day));
  if (done.has(yesterday) || yesterday >= today) return null;
  return dayStats(board, yesterday) ? yesterday : null;
}

/**
 * The wrap on offer right now.
 *
 * A wrap is written on the first open of the day after the day it covers,
 * so "written today" is exactly "today's offer". It stays on the board for
 * the whole of that day whether or not it has been read — reading only
 * quiets it down. Dismissing used to hide it for good, which turned a
 * stray tap into a lost day: the reading was then reachable from nowhere
 * at all. Tomorrow's wrap replaces it; there is nothing to clear.
 */
export function pendingWrap(wraps: DayWrap[], now: number): DayWrap | null {
  const today = dayKey(now);
  const mine = wraps.filter((w) => dayKey(w.at) === today);
  return mine.length ? mine[mine.length - 1] : null;
}

/** Union by action id — a tick is recorded once and never changes. */
export function mergeCompletions(a: Completion[], b: Completion[]): Completion[] {
  const by = new Map<string, Completion>();
  for (const c of [...(a ?? []), ...(b ?? [])]) if (!by.has(c.id)) by.set(c.id, c);
  return [...by.values()].sort((x, y) => x.at - y.at);
}

/**
 * Which of two wraps for the same day is the one to keep.
 *
 * Two devices offline overnight will each write their own reading of the
 * same day, and the model does not produce the same words twice. Keeping
 * whichever arrived first in argument order meant each device kept its own
 * and neither ever changed its mind: they disagreed permanently, because a
 * merge that depends on which side you are standing on does not converge.
 *
 * So the winner is decided by the wraps themselves, identically on both
 * sides: the one written first, and if they were written in the same
 * millisecond, the one whose text sorts first. Arbitrary, but the same
 * arbitrary answer everywhere, which is the whole requirement.
 */
function firstWritten(x: DayWrap, y: DayWrap): DayWrap {
  if (x.at !== y.at) return x.at < y.at ? x : y;
  return x.line <= y.line ? x : y;
}

/**
 * Merge two sets of wraps.
 *
 * Union by day. Where both hold the same day the tie-break above decides,
 * and `seen` is carried from either — dismissing on the phone should not
 * make it reappear on the laptop.
 */
export function mergeWraps(a: DayWrap[], b: DayWrap[]): DayWrap[] {
  const by = new Map<string, DayWrap>();
  for (const w of [...(a ?? []), ...(b ?? [])]) {
    const prev = by.get(w.day);
    if (!prev) {
      by.set(w.day, w);
      continue;
    }
    const keep = firstWritten(prev, w);
    by.set(w.day, { ...keep, seen: prev.seen || w.seen });
  }
  return [...by.values()].sort((x, y) => (x.day < y.day ? -1 : 1));
}

/** Clock time for a stamp, as the wrap shows it. */
function hm(at: number): string {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * The body sent to /api/wrap.
 *
 * Everything the model is allowed to state is assembled here, so the route
 * can forbid it from saying anything else. The recent lines ride along
 * because the reading worth having — "third day running on bugs" — cannot be
 * derived from a single day.
 */
export function wrapRequest(board: Board, day: string, wraps: DayWrap[]) {
  const stats = dayStats(board, day);
  if (!stats) return null;
  const names = new Map(board.threads.map((t) => [t.id, t.name]));
  return {
    day,
    stats: {
      said: stats.said,
      threadsMoved: stats.threadsMoved,
      actionsMade: stats.actionsMade,
      intentions: stats.intentions,
      threads: stats.threads,
      span: `${hm(stats.firstAt)} to ${hm(stats.lastAt)}`,
      returns: stats.returns.map(hm),
      finished: stats.finished.map((f) => f.text),
    },
    /* One line per utterance. Sending every destination entry repeated the
       secondary text to the model and made a split day look busier than it
       was. Where it went is listed once, with all of its destinations. */
    captures: (() => {
      const byUtterance = new Map<string, { at: string; text: string; where: string[] }>();
      for (const e of entriesFor(board, day)) {
        const key = e.captureId ?? e.id;
        const where = names.get(e.targetId) ?? e.kind;
        const seen = byUtterance.get(key);
        if (seen) {
          if (!seen.where.includes(where)) seen.where.push(where);
          continue;
        }
        byUtterance.set(key, {
          at: hm(e.at),
          text: e.raw || e.clean || "",
          where: [where],
        });
      }
      return [...byUtterance.values()].map((u) => ({
        at: u.at,
        text: u.text,
        where: u.where.join(" + "),
      }));
    })(),
    history: wraps
      .filter((w) => w.day < day)
      .slice(-HISTORY)
      .map((w) => ({ day: w.day, line: w.line })),
  };
}

/**
 * Accepting the model's reading of a day onto the board.
 *
 * Extracted from the hook with its two guards intact, each a race that was
 * handled inline: the day may ALREADY be wrapped by the time the reply
 * lands (the other device wrote it while our request was in flight — the
 * wraps list merges through sync like everything else), and the stats are
 * computed from the board AS IT IS NOW, not as it was when the request
 * left. Null means "nothing to write", never an error.
 */
export function acceptWrap(
  board: Board,
  day: string,
  out: { line: string; insights?: DayWrap["insights"]; tomorrow?: string; via?: string },
  at: number
): Board | null {
  if (!out.line) return null;
  if ((board.wraps ?? []).some((w) => w.day === day)) return null;

  const stats = dayStats(board, day);
  if (!stats) return null;
  const wrap: DayWrap = {
    day,
    at,
    stats,
    line: out.line,
    insights: out.insights ?? [],
    tomorrow: out.tomorrow ?? "",
    via: out.via,
  };
  return { ...board, wraps: [...(board.wraps ?? []), wrap] };
}

/** Read once: every unseen wrap stops calling attention to itself. Null
    when there is nothing unseen — no commit for a no-op. */
export function markWrapsSeen(board: Board): Board | null {
  const ws = board.wraps ?? [];
  if (!ws.some((w) => !w.seen)) return null;
  return { ...board, wraps: ws.map((w) => (w.seen ? w : { ...w, seen: true })) };
}
