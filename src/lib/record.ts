import type { CaptureEntry } from "./ledger";

/**
 * The record — the ledger made visible, quietly.
 *
 * The capture ledger has always known what you said and what became of it;
 * nothing in the UI ever showed it. This derives the two pieces Settings
 * renders: one editorial sentence of totals, and a twelve-week heat grid of
 * days — a colophon, not a scoreboard. No streaks, no goals, no judgement:
 * an empty day is a pale cell, never a broken chain.
 */

export type RecordStats = {
  total: number;
  /** Earliest capture in the ledger, or null when it is empty. */
  since: number | null;
  actions: number;
  threads: number;
  intentions: number;
  /** How many arrived by voice. */
  dictated: number;
};

export function recordStats(ledger: CaptureEntry[]): RecordStats {
  const stats: RecordStats = {
    total: ledger.length,
    since: null,
    actions: 0,
    threads: 0,
    intentions: 0,
    dictated: 0,
  };
  for (const e of ledger) {
    if (stats.since === null || e.at < stats.since) stats.since = e.at;
    /* "both" filed an action AND joined a thread — count it in each. */
    if (e.kind === "action" || e.kind === "both") stats.actions++;
    if (e.kind === "thread" || e.kind === "both") stats.threads++;
    if (e.kind === "intention") stats.intentions++;
    if (e.source === "dictated") stats.dictated++;
  }
  return stats;
}

/**
 * One capture, as evidence: what was said, what was filed, and where it
 * went. `said` prefers the recogniser's own words over the box text, since
 * for a dictated capture the box already holds a cleaned-up line.
 *
 * `differs` is the point of the whole thing — it marks the captures where
 * the engine changed the words, which are the only ones worth showing the
 * original for. When it rewrote nothing, showing both is noise.
 */
export type RecordEntry = {
  id: string;
  at: number;
  said: string;
  filed: string;
  kind: CaptureEntry["kind"];
  differs: boolean;
};

/** Compare the way a reader would: case, spacing and trailing punctuation
    are not the engine "changing your words". */
const normalise = (s: string) =>
  s.toLowerCase().replace(/\s+/g, " ").replace(/[.,;:!?]+$/g, "").trim();

/** The most recent captures, newest first, as evidence rows. */
export function recentCaptures(
  ledger: CaptureEntry[],
  limit = 12
): RecordEntry[] {
  return [...ledger]
    .sort((a, b) => b.at - a.at)
    .slice(0, limit)
    .map((e) => {
      const said = (e.transcript || e.raw || "").trim();
      const filed = (e.clean || "").trim();
      return {
        id: e.id,
        at: e.at,
        said,
        filed,
        kind: e.kind,
        differs: !!said && !!filed && normalise(said) !== normalise(filed),
      };
    });
}

export type HeatCell = {
  /** Local calendar day, for the title attribute. */
  day: string;
  count: number;
  /** 0 none · 1 one · 2 a few · 3 many. Fixed thresholds, so the same day
      always looks the same — a busy fortnight never dims the past. */
  level: 0 | 1 | 2 | 3;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Local yyyy-mm-dd, the bucketing key — days are the user's days. */
function dayKey(t: number): string {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function levelFor(count: number): HeatCell["level"] {
  if (count === 0) return 0;
  if (count === 1) return 1;
  if (count <= 4) return 2;
  return 3;
}

/** A month label for each column: named where a new month begins, blank
    elsewhere, so the grid reads as a calendar without becoming one. */
export function monthLabels(grid: HeatCell[][]): string[] {
  return grid.map((col, i) => {
    const month = col[0].day.slice(0, 7);
    if (i > 0 && grid[i - 1][0].day.slice(0, 7) === month) return "";
    return new Date(col[0].day + "T12:00:00").toLocaleDateString(undefined, {
      month: "short",
    });
  });
}

/**
 * The last `weeks` weeks as columns of seven days, oldest column first,
 * ending today. Rolling weeks rather than calendar-aligned ones: the grid
 * always ends on the current day, which is the day being asked about.
 */
export function heatGrid(
  ledger: CaptureEntry[],
  now: number,
  weeks = 12
): HeatCell[][] {
  const days = weeks * 7;
  const counts = new Map<string, number>();
  for (const e of ledger) {
    const key = dayKey(e.at);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const grid: HeatCell[][] = [];
  for (let w = 0; w < weeks; w++) {
    const col: HeatCell[] = [];
    for (let d = 0; d < 7; d++) {
      const idx = w * 7 + d;
      const day = dayKey(now - (days - 1 - idx) * DAY_MS);
      const count = counts.get(day) || 0;
      col.push({ day, count, level: levelFor(count) });
    }
    grid.push(col);
  }
  return grid;
}


/**
 * One line under the grid, and it has to earn being read.
 *
 * It used to be two: "the last twelve weeks, day by day — fullest on
 * August 6, 21 said" and "16 days marked · longest run 13 in a row". Five
 * numbers and a date. Nobody reads five numbers under a picture that has
 * already shown them the shape of their weeks.
 *
 * So: one comparison. The trick is the one that makes an abstract total
 * legible — turn the count into something a person can picture. What is
 * counted is words, because that is the thing a person has a feel for the
 * size of, and it comes from what they actually said, not from what the
 * engine made of it.
 */
const SIZES: [number, string][] = [
  [120, "a postcard"],
  [400, "a long text message"],
  [1200, "an email nobody asked for"],
  [3000, "a wedding speech"],
  [8000, "a short story"],
  [20000, "a very long essay"],
  [45000, "a novella"],
];

export type CaughtWords = { words: number; like: string } | null;

/** Words caught, and the familiar thing they add up to. Null below the
    first rung — "seven words, about a postcard" is a joke at nobody. */
export function caughtWords(ledger: CaptureEntry[]): CaughtWords {
  let words = 0;
  for (const e of ledger) {
    const said = (e.raw || e.clean || "").trim();
    if (said) words += said.split(/\s+/).length;
  }
  if (words < SIZES[0][0]) return null;
  let like = "a novel";
  for (const [max, name] of SIZES) {
    if (words < max) {
      like = name;
      break;
    }
  }
  /* Two significant figures: "about 4,200" is a comparison, "4,237" is a
     measurement, and this line is not a measurement. */
  const round =
    words >= 1000 ? Math.round(words / 100) * 100 : Math.round(words / 10) * 10;
  return { words: round, like };
}
