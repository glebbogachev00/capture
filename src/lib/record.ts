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
