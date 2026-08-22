/**
 * A series: the next one in a set, not a change of subject.
 *
 * Three X-post drafts pasted three minutes apart landed as three threads.
 * Every routing test the sorter has is about SUBJECT — is this capture
 * about what that thread is about — and the subject of each draft was
 * different, so each draft got its own thread. What they shared was not a
 * subject but a shape: a titled block of prose, the same shape as the one
 * captured a few minutes earlier, which had just opened a thread for
 * exactly this. A person doing that is building a set.
 *
 * The model cannot see "a few minutes ago" and "the same shape" reliably
 * from a list of twenty earlier captures, so the client decides whether a
 * series is plausible and says so outright. The model still chooses — a
 * genuinely different kind of thing overrides it — but the default is
 * named, with the thread id attached.
 */

/** A previous capture is "just now" within this window. */
export const SERIES_WINDOW_MS = 30 * 60_000;

/** Shorter than this is a sentence, and sentences in a row are not a set. */
const LONG = 150;

/** Two pastes of the same shape: both substantial, and either both carry
    paragraph breaks or both open with the same kind of heading. */
export function sameShape(a: string, b: string): boolean {
  const x = a.trim();
  const y = b.trim();
  if (x.length < LONG || y.length < LONG) return false;
  const paragraphs = (t: string) => /\n\s*\n/.test(t);
  const headed = (t: string) => /^[^\n]{1,60}(—|–|:)\s/.test(t);
  return (paragraphs(x) && paragraphs(y)) || (headed(x) && headed(y));
}

export type Series = { threadId: string; threadName: string; minutesAgo: number };

/**
 * The series this capture plausibly continues, or null.
 * `previous` is the most recent capture that landed on a thread.
 */
export function seriesFor(
  raw: string,
  previous:
    | { raw: string; at: number; threadId: string; threadName: string }
    | null
    | undefined,
  now = Date.now()
): Series | null {
  if (!previous) return null;
  const age = now - previous.at;
  if (age < 0 || age > SERIES_WINDOW_MS) return null;
  if (!sameShape(previous.raw, raw)) return null;
  return {
    threadId: previous.threadId,
    threadName: previous.threadName,
    minutesAgo: Math.max(1, Math.round(age / 60_000)),
  };
}
