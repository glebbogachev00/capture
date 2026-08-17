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
  /** For a dictated capture: what the recogniser actually heard, before the
      cleanup pass rewrote it. The tidied words are a convenience; this is
      the evidence, so a bad transcription can never be the only record. */
  transcript?: string;
  imgs?: string[];
};

/**
 * The Correction Ledger — every proposal outcome and correction, appended
 * next to the capture ledger.
 *
 * The capture ledger records what the engine DID with the user's words; the
 * correction ledger records what the user did with the engine's proposals —
 * accepted, dismissed, renamed, corrected. That accept/dismiss/correct signal
 * is what a bounded personal model (Sprint 3) will learn from: which
 * suggestions this person takes and which they wave off. Like the capture
 * ledger it is append-only and invisible in the UI — just data, ready to be
 * exported and learned from later.
 */
export type ProposalKind =
  | "rename_thread"
  | "clean_fragment"
  | "extract_action"
  | "combine_fragments"
  | "refresh_summary"
  | "related_suggestion"
  /** The sorter filed a capture and the user moved it straight back out —
      an unprompted correction, with the right answer attached. The only
      signal here that is about the ENGINE's mistake rather than about a
      proposal the engine offered. */
  | "refiled";

export type CorrectionEntry = {
  id: string;
  at: number;
  proposalKind: ProposalKind;
  accepted: boolean;
  /** What the proposal was about, in plain words — the thread, action, or
      fragment involved — so a later model pass has something to weigh. */
  context: string;
  /** What the user actually wrote instead, when they corrected the proposal. */
  correctionText?: string;
  /** A distilled rule the correction implies ("threads get renamed to…"). */
  rule?: string;
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

/**
 * Add a correction to the ledger, newest first — same append-only semantics
 * as the capture ledger: idempotent by id, capped at LEDGER_CAP.
 */
export function appendCorrections(
  corrections: CorrectionEntry[],
  entry: CorrectionEntry
): CorrectionEntry[] {
  const out = [entry, ...corrections.filter((e) => e.id !== entry.id)];
  return out.length > LEDGER_CAP ? out.slice(0, LEDGER_CAP) : out;
}

/** Union two correction ledgers by id, newest first — identical shape to
    mergeLedgers, because corrections are as immutable as captures. */
export function mergeCorrections(
  a: CorrectionEntry[],
  b: CorrectionEntry[]
): CorrectionEntry[] {
  const byId = new Map<string, CorrectionEntry>();
  for (const e of [...a, ...b]) if (e?.id) byId.set(e.id, e);
  return [...byId.values()]
    .sort((x, y) => y.at - x.at || (x.id < y.id ? 1 : -1))
    .slice(0, LEDGER_CAP);
}

/** Fold a correction into a board in one step. */
export function withCorrection(
  board: Board,
  entry: CorrectionEntry
): Board {
  return {
    ...board,
    corrections: appendCorrections(board.corrections ?? [], entry),
  };
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
