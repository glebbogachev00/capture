/**
 * Thread covers — a little identity for a thread you are building out.
 *
 * Threads are the things that accumulate: a project, a bug list, a subject
 * you keep returning to. A cover is how one becomes recognisable at a
 * glance, before the name is read.
 *
 * Two kinds, one field:
 *   "tone:<name>"  a flat colour from the palette below
 *   "img:<id>"     a photo, stored under the usual IMG(id) key
 *
 * A tone is deliberately the default path: it always works, costs nothing
 * to store, syncs as eight characters, and never depends on the thread
 * having a photo in it — which most threads never will.
 *
 * Threads without a cover render exactly as they always have. The board
 * stays quiet unless you decide otherwise.
 */

export type CoverKind = "tone" | "img";

export type Cover =
  | { kind: "tone"; tone: ToneName }
  | { kind: "img"; id: string };

/**
 * Muted, paper-adjacent hues — the app's own palette widened just enough to
 * tell threads apart. Nothing saturated: a cover should mark a thread, not
 * shout over the text sitting under it.
 */
export const TONES = {
  sage: "#a8bfae",
  clay: "#c4a091",
  sand: "#d6c9a8",
  sky: "#a6bccb",
  plum: "#b4a3bd",
  moss: "#8fa07c",
  rose: "#cfa8ac",
  slate: "#a3aab0",
} as const;

export type ToneName = keyof typeof TONES;

export const TONE_NAMES = Object.keys(TONES) as ToneName[];

const isTone = (v: string): v is ToneName => v in TONES;

/** Read a stored cover value. Unknown or malformed values read as none, so
    a board written by a newer version never renders something broken. */
export function parseCover(value: string | null | undefined): Cover | null {
  if (!value || typeof value !== "string") return null;
  const [kind, rest] = [value.slice(0, value.indexOf(":")), value.slice(value.indexOf(":") + 1)];
  if (kind === "tone" && isTone(rest)) return { kind: "tone", tone: rest };
  if (kind === "img" && /^[A-Za-z0-9_-]{1,64}$/.test(rest))
    return { kind: "img", id: rest };
  return null;
}

export const toneValue = (t: ToneName) => `tone:${t}`;
export const imgValue = (id: string) => `img:${id}`;

/** The colour a tone paints, or null when the cover is a photo (or none). */
export function toneColour(cover: Cover | null): string | null {
  return cover?.kind === "tone" ? TONES[cover.tone] : null;
}
