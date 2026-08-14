import { DAY } from "./model";

/**
 * Stated deadlines.
 *
 * Shelf life is judged from what a thing IS — a call to return fades in a
 * day, real work gets a month. That is right for most captures and wrong
 * for the one kind that matters most: a capture that names its own date.
 * "Renew the car insurance before the 28th" said on the 5th is ordinary
 * errand-shaped, so it draws a week, and fades sixteen days before it is
 * due. The deadline was in the words the whole time.
 *
 * So the sorter reads the date, and it does one thing: it stops the action
 * fading before the day it names. No reminder, no calendar write, nothing
 * that leaves the app — the deadline just tightens the shelf life the app
 * already had.
 */

/**
 * A bare "2026-09-28" is a DAY, not an instant.
 *
 * Date.parse reads it as UTC midnight, which in a western timezone is the
 * evening before — so "due the 28th" would show as the 27th. And a deadline
 * named as a day is not due at 00:00 of it; it is due by the end of it.
 * Both are fixed by building local end-of-day ourselves.
 */
function dateOnly(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  const [, y, mo, d] = m;
  return new Date(Number(y), Number(mo) - 1, Number(d), 23, 59, 0, 0).getTime();
}

/** How long a dated action outlives its deadline, so a thing due today is
    still there tonight when it is actually done. */
export const AFTER_DUE = DAY;

/** Nothing sensible is due more than two years out; a model that returns
    "3025-01-01" has hallucinated a century, not read a date. */
const MAX_AHEAD = 730 * DAY;

/**
 * The model's date string as a timestamp, or null when there isn't a usable
 * one. Deliberately strict: a bad date silently widening a shelf life would
 * be worse than no date at all.
 */
export function parseDue(
  iso: string | null | undefined,
  now: number
): number | null {
  if (!iso || typeof iso !== "string") return null;
  const t = dateOnly(iso) ?? Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  /* Already long past: the capture is about something that has been and
     gone, and pinning a shelf life to it would only resurrect noise. */
  if (t < now - DAY) return null;
  if (t > now + MAX_AHEAD) return null;
  return t;
}

/**
 * When an action should fade.
 *
 * The shelf life it was judged to deserve, except that a stated deadline
 * always wins when it reaches further: nothing fades before the date it
 * named. "keep" still means keep — no expiry at all.
 */
export function expiryFor(
  span: number | null,
  due: number | null,
  now: number
): number | null {
  if (span === null) return null;
  const ordinary = now + span;
  if (due === null) return ordinary;
  return Math.max(ordinary, due + AFTER_DUE);
}
