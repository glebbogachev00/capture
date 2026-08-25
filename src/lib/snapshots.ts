import type { Board } from "./model";

/**
 * A week of rollbacks, kept on the device.
 *
 * Sync is a mirror, not a backup: a bad merge or a deletion propagates
 * everywhere within half a minute, and the hub faithfully holds the
 * damage. Export is the right defence and nobody remembers to run it. So
 * once a day, before anything merges, the board is copied under a dated
 * key and the oldest beyond seven is dropped.
 *
 * Deliberately local and deliberately dumb: no network, no revisions on
 * the hub, no cost. It does not protect against a browser evicting its
 * storage — the hub already does that — it protects against the board
 * being wrong.
 */
export const SNAPSHOT_PREFIX = "capture:snapshot:";
export const SNAPSHOT_KEEP = 7;

/** Local calendar day: a person's day, not UTC's. */
export function snapshotDay(at: number): string {
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export const snapshotKey = (day: string) => `${SNAPSHOT_PREFIX}${day}`;

/** Newest first, from whatever keys the store holds. */
export function snapshotDays(keys: string[]): string[] {
  return keys
    .filter((k) => k.startsWith(SNAPSHOT_PREFIX))
    .map((k) => k.slice(SNAPSHOT_PREFIX.length))
    .sort()
    .reverse();
}

/** Which days to drop so only the newest SNAPSHOT_KEEP survive. */
export function expiredDays(days: string[], keep = SNAPSHOT_KEEP): string[] {
  return [...days].sort().reverse().slice(keep);
}

/** Worth keeping? An empty board overwriting a real one is the one way
    this feature could destroy what it exists to protect. */
export function worthSnapshotting(board: Board): boolean {
  return (
    board.actions.length > 0 ||
    board.threads.length > 0 ||
    board.intentions.length > 0
  );
}

/** How a stored day reads in a list: "Mon 25 Aug". */
export function snapshotLabel(day: string): string {
  const d = new Date(day + "T12:00:00");
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}
