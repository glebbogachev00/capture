/**
 * The Capture Ledger — append-only memory of every capture.
 *
 * The board keeps what the capture BECAME; the ledger keeps how it got there.
 * One entry per capture, recording what was said (raw), what the engine made
 * of it (clean), where it landed (kind + targetId), and which model path
 * handled it (via). Entries are immutable once written — the ledger is never
 * edited, only appended to — which makes it trivially safe to sync: merging
 * two ledgers is a union by id, no conflicts possible.
 *
 * The ledger is deliberately invisible in the UI. It exists to make Capture
 * debuggable, exportable, and agent-readable: "what did I actually say, and
 * what happened to it?"
 */

import type { Board } from "./model";

export type CaptureSource = "typed" | "dictated" | "distill" | "image" | "import";

export type CaptureEntry = {
  id: string;
  at: number;
  /** What was said or pasted, before the engine touched it. */
  raw: string;
  /** The wording that actually landed on the board. */
  clean: string;
  kind: "action" | "thread" | "intention" | "both";
  source: CaptureSource;
  /** The item the capture became (or the thread it folded into). */
  targetId: string;
  /** For a thread capture, the fragment inside it. */
  targetFragId?: string;
  /** Which model tier answered — the `via` the routes already report. */
  modelVia?: string;
  imgs?: string[];
};

/** How many entries the board keeps: a real record, yet light enough that
    sync payloads and the export stay small. Oldest entries drop first. */
export const LEDGER_CAP = 500;

/**
 * Add a capture to the ledger, newest first.
 *
 * Idempotent by id (a re-sent entry never duplicates), and capped: beyond
 * `LEDGER_CAP` the oldest entries give way, because the ledger is a recent
 * memory, not an archive.
 */
export function appendLedger(
  ledger: CaptureEntry[],
  entry: CaptureEntry
): CaptureEntry[] {
  const out = [entry, ...ledger.filter((e) => e.id !== entry.id)];
  return out.length > LEDGER_CAP ? out.slice(0, LEDGER_CAP) : out;
}

/** Union two ledgers by id, newest first. Entries never change, so the merge
    is add-only — no last-writer-wins, no conflicts, nothing to reconcile.
    The id tiebreak keeps the order deterministic even when two entries were
    written in the same millisecond on different devices. */
export function mergeLedgers(
  a: CaptureEntry[],
  b: CaptureEntry[]
): CaptureEntry[] {
  const byId = new Map<string, CaptureEntry>();
  for (const e of [...a, ...b]) if (e?.id) byId.set(e.id, e);
  return [...byId.values()]
    .sort((x, y) => y.at - x.at || (x.id < y.id ? 1 : -1))
    .slice(0, LEDGER_CAP);
}

/** How to classify a capture: an image with no words is "image"; the rest
    split on whether the words came from the microphone or the keyboard. */
export function sourceOf(
  raw: string,
  dictated: boolean,
  hasImages: boolean
): CaptureSource {
  if (!raw && hasImages) return "image";
  return dictated ? "dictated" : "typed";
}

/** Fold an entry into a board's ledger in one step. */
export function withLedger(board: Board, entry: CaptureEntry): Board {
  return { ...board, ledger: appendLedger(board.ledger ?? [], entry) };
}
