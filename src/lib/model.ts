/**
 * The shape of the board, and the rules that decide what stays on it.
 *
 * Threads are never deleted. Only actions fade.
 */

import { del } from "./storage";

export const KEY = "capture:data:v1";
export const IMG = (id: string) => "capture:img:" + id;
/**
 * Where a board that failed to parse is parked before the next capture
 * overwrites the live key, so the unreadable copy is not instantly lost.
 */
export const CORRUPT = "capture:corrupt:v1";

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

/**
 * An intention: a thing declared as already true, plus what pulls against it.
 *
 * Deliberately not an action. `recommendedActions` are written from the
 * fulfilled end-state — things you do because this is already so — and they
 * must never grow a checkbox, a shelf life, or the ability to fade. Actions
 * are closed; intentions are inhabited. Keeping the two apart is the whole
 * reason this is a separate record rather than a flag on Action.
 */
export type Intention = {
  id: string;
  /** Stable display number, as in "(03)". Carried over from intent. */
  number: number;
  /** What was actually said, before the engine touched it. */
  rawInput: string;
  /** Present tense, embodied, keeping the speaker's own specifics. */
  expandedIntention: string;
  /** Exactly three, taken from the fulfilled state. Never todos. */
  recommendedActions: string[];
  /** Two to four recurring behaviours pulling against this one. */
  counterIntentions: string[];
  at: number;
  updatedAt: number;
};

/**
 * A principle silently applied to every intention the engine writes.
 *
 * These never appear in the output; they shape it. Disabling one changes how
 * future intentions read without touching any already saved.
 */
export type Principle = {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  /** Shipped with the app rather than written by hand; cannot be deleted. */
  builtin?: boolean;
};

export type Board = {
  actions: Action[];
  threads: Thread[];
  intentions: Intention[];
  principles: Principle[];
};

/** The engine principles intent shipped with, carried over unchanged. */
export const SEED_PRINCIPLES: Principle[] = [
  ["Clarity Before Action", "Increase clarity before increasing effort. Clarity creates better decisions."],
  ["Systems Over Emotion", "Don't react emotionally. Find the recurring problem and build a system for it."],
  ["Repetition = System", "If something happens repeatedly: automate it, delegate it, or eliminate it."],
  ["Correct Framing", "Most poor decisions begin with incorrect framing. Find the real problem underneath."],
  ["Neutral State", "Remove assumptions. Observe first. Decide second."],
  ["Balance Over Force", "Don't force reality. Maintain balance. Take aligned action."],
  ["Simplify", "Always simplify. Remove before adding. Complexity is a cost."],
  ["Replace, Don't Add", "Replace existing habits instead of stacking new ones on top."],
  ["Present-Tense Intentions", 'Intentions are written as already achieved. Never "I want" — always "I have".'],
  ["Intentions Over Goals", "Goals exist in the future. Intentions describe reality now."],
  ["Remove Counter-Intentions", "Every intention has opposing behaviors. Name and remove them before adding more effort."],
  ["Experiment Over Explanation", "Don't endlessly explain. Run small experiments, observe, learn, repeat."],
  ["Build Last", "Before building, ask: does something already exist? Can it be adapted? Only build when necessary."],
  ["Don't Diagnose Too Early", "Treat explanations as hypotheses, not truths."],
  ["Inner Certainty, Outer Humility", "Act from abundance internally. Remain humble externally."],
].map(([name, description], i) => ({
  id: `seed-${i}`,
  name,
  description,
  enabled: true,
  builtin: true,
}));

export const EMPTY: Board = {
  actions: [],
  threads: [],
  intentions: [],
  principles: SEED_PRINCIPLES,
};

/**
 * Fill in anything a board saved by an older version is missing.
 *
 * Boards written before intentions existed have no `intentions` or
 * `principles` key, and reading them would otherwise crash on first render.
 */
export function hydrate(raw: Partial<Board> | null | undefined): Board {
  return {
    actions: raw?.actions ?? [],
    threads: raw?.threads ?? [],
    intentions: raw?.intentions ?? [],
    principles: raw?.principles?.length ? raw.principles : SEED_PRINCIPLES,
  };
}

export const nextNumber = (intentions: Intention[]) =>
  intentions.reduce((m, i) => Math.max(m, i.number || 0), 0) + 1;

export const pad = (n: number) => String(n).padStart(2, "0");

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
