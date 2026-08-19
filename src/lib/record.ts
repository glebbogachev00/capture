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

/** The fullest day on the grid, or null when every day is empty. */
export function busiestDay(grid: HeatCell[][]): HeatCell | null {
  let best: HeatCell | null = null;
  for (const cell of grid.flat()) {
    if (cell.count > (best?.count ?? 0)) best = cell;
  }
  return best;
}

export type RecordRun = {
  /** Days on the grid with at least one capture. */
  marked: number;
  /** The longest unbroken stretch of marked days. */
  longest: number;
};

/**
 * How much of the grid is filled, and the longest run without a gap.
 *
 * The grid answers "when"; this answers "how steadily", which is the part
 * worth being a little pleased about. Days are read in calendar order, so
 * a run crosses column boundaries — the columns are a layout, not a week
 * the streak should care about.
 */
export function recordRun(grid: HeatCell[][]): RecordRun {
  const days = grid
    .flat()
    .slice()
    .sort((a, b) => a.day.localeCompare(b.day));
  let marked = 0;
  let longest = 0;
  let run = 0;
  for (const cell of days) {
    if (cell.count > 0) {
      marked++;
      run++;
      if (run > longest) longest = run;
    } else {
      run = 0;
    }
  }
  return { marked, longest };
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
