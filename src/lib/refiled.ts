import { contentWords } from "./related";

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
 * "the sorter was wrong, and here is where it belonged" — and becomes a rule
 * the sorter reads next time, through machinery that already exists.
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

/**
 * The lesson a re-file teaches, as a plain sentence.
 *
 * The subject is the phrase the capture shares with its new home — the same
 * evidence Organize quotes when it explains itself. When they share nothing
 * quotable, the capture's own distinctive words stand in, so the rule still
 * names what it is about rather than saying "captures like this".
 *
 * Returns null when there is nothing specific enough to say. A vague rule is
 * worse than none: it would match everything and drag unrelated captures
 * into one thread.
 */
export function refileRule(
  captureText: string,
  threadName: string,
  threadText: string
): string | null {
  const home = threadName.trim();
  if (!home) return null;

  const subject = canonicalSubject(captureText, threadText || threadName);
  if (!subject) return null;

  return `Captures about "${subject}" belong in "${home}"`;
}

/**
 * The subject, worded the same way every time.
 *
 * This is what makes the loop compound, and getting it wrong made the first
 * build useless: two re-files teaching the identical lesson produced
 * "cold brew again" and "cold brew", which deriveRules read as two unrelated
 * rules with one signal each — so neither ever reached the two-signal bar and
 * nothing was learned.
 *
 * The fix is to stop letting the capture's phrasing choose the words. The
 * subject is the words the capture and its new home have in COMMON, written
 * in the order the home says them. The home is the stable anchor: it is the
 * same text for every capture that lands there, so the same lesson always
 * spells itself the same way.
 */
function canonicalSubject(captureText: string, threadText: string): string {
  const inCapture = new Set(contentWords(captureText));
  const shared: string[] = [];
  for (const w of contentWords(threadText)) {
    if (inCapture.has(w) && !shared.includes(w)) shared.push(w);
    if (shared.length === 2) break;
  }
  if (shared.length) return shared.join(" ");

  /* Nothing in common: the move was about something the home does not say
     yet. One word only — the most distinctive the capture has — because a
     longer fallback phrase would vary with the sentence around it and split
     the rule again. */
  return contentWords(captureText)[0] || "";
}

/** The kinds a capture can be sorted into, for the undo lesson. */
export type SortKind = "action" | "thread" | "intention";

const KIND_WORD: Record<SortKind, string> = {
  action: "an action",
  thread: "a thread",
  intention: "an intention",
};

/**
 * The lesson in an undo that was answered.
 *
 * Undo alone is only a complaint: it says the sorting was wrong and nothing
 * about what was right, which is not enough to learn from. Once the person
 * taps the kind it should have been, the pair becomes a rule in the same
 * shape as a re-file — anchored on the subject rather than the wording, so
 * two corrections about the same subject aggregate instead of splitting.
 */
export function undoRule(
  captureText: string,
  wrong: SortKind,
  right: SortKind
): string | null {
  if (wrong === right) return null;
  const words = contentWords(captureText).slice(0, 2);
  if (!words.length) return null;
  return `Captures about "${words.join(" ")}" are ${KIND_WORD[right]}, not ${KIND_WORD[wrong]}`;
}
