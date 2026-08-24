/**
 * The shape of the board, and the rules that decide what stays on it.
 *
 * Threads are never deleted. Only actions fade.
 */

/* The ledger types live in their own module; model re-exports them so the
   whole board can be described from one import. */
import type { CaptureEntry, CorrectionEntry } from "./ledger";
export type { CaptureEntry, CorrectionEntry };
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

/**
 * How long each species of action stays on the board before fading.
 *
 * These are the canonical spans. The manual shelf picker and the model's
 * `shelfLife` both read from here, so a stored `shelf` label always means the
 * same duration whoever set it: "days" is a week, "weeks" a month.
 */
export const SHELF: Record<ShelfLife, number | null> = {
  hours: DAY,
  days: 7 * DAY,
  weeks: 30 * DAY,
  keep: null,
};
/** Faded items sit recoverable this long, then go for good. */
export const GRACE = 14 * DAY;
/** Legacy done actions (ticked before ticking deleted outright) clear this
    long after they were completed. New ticks remove the action at once. */
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
  /** A deadline the capture named for itself. Advisory: it holds the action
      on the board until its date, and is shown — it never leaves the app. */
  due?: number | null;
  doneAt?: number | null;
  faded?: boolean;
  fadedAt?: number | null;
  /** Landed here raw because no model would answer. Can be sorted later. */
  unsorted?: boolean;
  /** The thread this action arrived with — a "both" capture, a taken next
      step, an extraction. The seam between the two halves of one moment,
      kept so the thread can show what it gave rise to. */
  threadId?: string;
  /** A picture arrived with this capture and lives on a thread fragment.
      Actions are made to be cleared away and threads are made to keep
      things, so the image is never owned by the row that will be ticked
      off — this only points at where to find it. */
  shot?: { threadId: string; fragId: string };
  /** When this item last changed — the sync merge compares these. */
  updatedAt?: number;
};

export type Frag = {
  id: string;
  at: number;
  text: string;
  imgs?: string[];
  /** As above: saved verbatim, never cleaned up. */
  unsorted?: boolean;
  updatedAt?: number;
};

export type Thread = {
  id: string;
  name: string;
  summary: string;
  frags: Frag[];
  /** A little identity for a thread being built out: "tone:sage" or
      "img:<id>". Display only — it never touches the summary or the
      fragments. See lib/cover.ts. */
  cover?: string;
  /** The one concrete thing to do next, read off the fragments with the
      summary; null or absent when the thread is thinking, not doing. Shown
      under "Where this stands", one tap to make it an action. */
  next?: string | null;
  /** The step they waved away — it stays away until the thread moves and
      the summary names a different one. */
  nextDismissed?: string;
  updatedAt?: number;
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
  updatedAt?: number;
};

export type Board = {
  actions: Action[];
  threads: Thread[];
  intentions: Intention[];
  principles: Principle[];
  /** Append-only memory of every capture: what was said, what it became,
      where it landed, and which model path handled it. Invisible in the UI;
      it exists so the board's history can be debugged and exported. */
  ledger: CaptureEntry[];
  /** Append-only memory of every proposal outcome: which suggestions the
      user accepted, dismissed, renamed, or corrected — the signal a bounded
      personal model will learn from. Same sync semantics as the ledger. */
  corrections: CorrectionEntry[];
  /** When the history was last started over. The ledger and corrections
      are append-only and union-merged, which means no single copy can ever
      empty them: a wiped hub got its history straight back from the first
      tab that synced. A wipe bumps this instead; on merge, the side with
      the older epoch drops its history. Absent means zero. */
  historyEpoch?: number;
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
  updatedAt: 0,
}));

export const EMPTY: Board = {
  actions: [],
  threads: [],
  intentions: [],
  principles: SEED_PRINCIPLES,
  ledger: [],
  corrections: [],
};

/**
 * Fill in anything a board saved by an older version is missing.
 *
 * Boards written before intentions existed have no `intentions` or
 * `principles` key, and reading them would otherwise crash on first render.
 */
export function hydrate(raw: Partial<Board> | null | undefined): Board {
  /* Items written before sync existed carry no updatedAt; fall back to their
     creation time so the first merge has something sane to compare. */
  const stamped = <T extends { updatedAt?: number; at?: number }>(x: T): T => ({
    ...x,
    updatedAt: x.updatedAt ?? x.at ?? 0,
  });
  return {
    actions: (raw?.actions ?? []).map(stamped),
    threads: (raw?.threads ?? []).map((t) => ({
      ...t,
      updatedAt: t.updatedAt ?? t.frags?.at(-1)?.at ?? 0,
      frags: (t.frags ?? []).map(stamped),
    })),
    intentions: (raw?.intentions ?? []).map(stamped),
    principles: (raw?.principles?.length ? raw.principles : SEED_PRINCIPLES).map(
      (p) => ({ ...p, updatedAt: p.updatedAt ?? 0 })
    ),
    /* Boards written before the ledger existed carry no ledger key at all;
       hydrate to empty rather than crash. Malformed entries are dropped. */
    ledger: (raw?.ledger ?? []).filter(
      (e) => e && typeof e.id === "string" && typeof e.at === "number"
    ),
    historyEpoch: typeof raw?.historyEpoch === "number" ? raw.historyEpoch : 0,
    corrections: (raw?.corrections ?? []).filter(
      (e) =>
        e &&
        typeof e.id === "string" &&
        typeof e.at === "number" &&
        typeof e.proposalKind === "string" &&
        typeof e.accepted === "boolean"
    ),
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

/**
 * A deadline reads as a day.
 *
 * The hour is deliberately not shown. Live captures proved the model is
 * unreliable about it in both directions — it invented "7:00 AM" for a
 * capture that named no time, and read "Friday at 5" as 05:00 — and a
 * confidently wrong clock time is worse than none. The day is the part it
 * gets right, and any time that was actually said is already in the
 * action's own words. The full timestamp is still stored; only the display
 * is coarse.
 */
export const fmtDue = (t: number) =>
  new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" });

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
  const clearedIds: string[] = [];
  const kept: Action[] = [];

  for (const a of data.actions) {
    /* Legacy done actions clear themselves after a week — ticking is the
       finish line, not the start of a new chore. New ticks never reach
       here: toggleAction removes the action the moment it is completed. */
    if (a.done && a.doneAt && now - a.doneAt > AFTER_DONE) {
      await dropImages(a.imgs);
      cleared++;
      clearedIds.push(a.id);
      continue;
    }
    if (a.faded && a.fadedAt && now - a.fadedAt > GRACE) {
      await dropImages(a.imgs);
      cleared++;
      clearedIds.push(a.id);
      continue;
    }
    if (!a.done && !a.faded && a.expires && now > a.expires) {
      // Fading is a change like any other — the other device must see it.
      kept.push({ ...a, faded: true, fadedAt: now, updatedAt: now });
      faded++;
      continue;
    }
    kept.push(a);
  }

  return { next: { ...data, actions: kept }, faded, cleared, clearedIds };
}
