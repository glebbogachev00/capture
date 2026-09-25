import type { CorrectionEntry } from "./model";

/**
 * Learning from the fix, not from the suggestion.
 *
 * The correction ledger has always recorded what you did with the engine's
 * PROPOSALS — accepted this tidy claim, dismissed that one. It never
 * recorded the engine's own mistakes. When the sorter filed a capture in the
 * wrong thread and you quietly moved it, the most valuable signal in the app
 * evaporated: an unprompted correction, with the right answer attached.
 *
 * This is that signal. A move made soon after a capture landed is read as
 * "the sorter was wrong, and here is where it belonged" and is retained as
 * a bounded semantic example for the model.
 *
 * Deliberately narrow. A move weeks later is ordinary housekeeping: you
 * reorganised, the sorter was not wrong at the time, and treating it as a
 * correction would teach the engine from your changing mind rather than from
 * its own errors.
 */

/**
 * How soon after landing a move still counts as fixing the sorter.
 *
 * Ten minutes: long enough to read the capture, see it in the wrong place
 * and drag it out; short enough that it cannot be a later reorganisation.
 */
export const REFILE_WINDOW_MS = 10 * 60 * 1000;

/** Was this move a correction of the sort, or just housekeeping? */
export function isRefile(capturedAt: number, movedAt: number): boolean {
  const age = movedAt - capturedAt;
  return age >= 0 && age <= REFILE_WINDOW_MS;
}

/** The kinds a capture can be sorted into, for the undo lesson. */
export type SortKind = "action" | "thread" | "intention";

/** An explicit kind correction, ready for the existing correction ledger. */
export function answeredKindCorrection(
  raw: string, wrong: SortKind, right: SortKind
): Omit<CorrectionEntry, "id" | "at"> | null {
  const context = raw.trim().slice(0, 160);
  if (!context || wrong === right) return null;
  return {
    proposalKind: "undone",
    accepted: true,
    context,
    routing: { kind: right },
  };
}
