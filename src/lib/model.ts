/**
 * The shape of the board, and the rules that decide what stays on it.
 *
 * Threads are never deleted. Only actions fade.
 */

import { del } from "./storage";

export const KEY = "capture:data:v1";
export const IMG = (id: string) => "capture:img:" + id;

export const DAY = 864e5;
export const HOUR = 36e5;

/** How long each species of action stays on the board before fading. */
export const SHELF: Record<ShelfLife, number | null> = {
  hours: DAY,
  days: 4 * DAY,
  weeks: 21 * DAY,
  keep: null,
};
/** Faded items sit recoverable this long, then go for good. */
export const GRACE = 14 * DAY;
/** Completed items clear themselves this long after you tick them. */
export const AFTER_DONE = 7 * DAY;
/** A thread with no new fragments for this long moves to Resting. */
export const DORMANT = 60 * DAY;

export type ShelfLife = "hours" | "days" | "weeks" | "keep";

export type Action = {
  id: string;
  text: string;
  done: boolean;
  at: number;
  src?: string;
  imgs?: string[];
  shelf: ShelfLife;
  expires: number | null;
  doneAt?: number | null;
  faded?: boolean;
  fadedAt?: number | null;
  /** Landed here raw because no model would answer. Can be sorted later. */
  unsorted?: boolean;
};

export type Frag = {
  id: string;
  at: number;
  text: string;
  imgs?: string[];
  /** As above: saved verbatim, never cleaned up. */
  unsorted?: boolean;
};

export type Thread = {
  id: string;
  name: string;
  summary: string;
  frags: Frag[];
};

export type Board = {
  actions: Action[];
  threads: Thread[];
};

export const EMPTY: Board = { actions: [], threads: [] };

export const uid = () => Math.random().toString(36).slice(2, 10);

export const fmt = (t: number) =>
  new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" }) +
  " · " +
  new Date(t).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

export const left = (ms: number) =>
  ms <= 0
    ? "now"
    : ms >= DAY
      ? Math.ceil(ms / DAY) + "d"
      : Math.max(1, Math.ceil(ms / HOUR)) + "h";

export async function dropImages(ids: string[] | undefined) {
  for (const id of ids || []) {
    try {
      await del(IMG(id));
    } catch {
      /* already gone */
    }
  }
}

/** The cleanup pass. Runs on open. Never touches threads. */
export async function sweep(data: Board) {
  const now = Date.now();
  let faded = 0;
  let cleared = 0;
  const kept: Action[] = [];

  for (const a of data.actions) {
    if (a.done && a.doneAt && now - a.doneAt > AFTER_DONE) {
      await dropImages(a.imgs);
      cleared++;
      continue;
    }
    if (a.faded && a.fadedAt && now - a.fadedAt > GRACE) {
      await dropImages(a.imgs);
      cleared++;
      continue;
    }
    if (!a.done && !a.faded && a.expires && now > a.expires) {
      kept.push({ ...a, faded: true, fadedAt: now });
      faded++;
      continue;
    }
    kept.push(a);
  }

  return { next: { ...data, actions: kept }, faded, cleared };
}
