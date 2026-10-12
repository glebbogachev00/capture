import { z } from "zod";

/**
 * Capture keeps a person's language. Their own words are never translated;
 * this is only for the few things the model writes itself (a new Thread's
 * name, an action it reworded, a Thread summary), which sometimes come back
 * in English for a Russian capture. Russian is the one language this knows so
 * far, told apart by its alphabet; English captures never reach any of this.
 */

const CYRILLIC = /[Ѐ-ӿ]/;

/** Most of the letters are Cyrillic. */
export function writtenInRussian(text: string): boolean {
  const letters = text.match(/\p{L}/gu) ?? [];
  if (!letters.length) return false;
  return letters.filter((letter) => CYRILLIC.test(letter)).length / letters.length >= 0.5;
}

/** Model-written text for a Russian source that has no Russian in it at all. */
export const needsRussian = (source: string, text: string | null | undefined): text is string =>
  !!text && writtenInRussian(source) && !CYRILLIC.test(text);

/* Longer text (a Thread summary) is rewritten on its own: shown the note, the
   model copied the note's sentences instead of the summary. */
export const TO_RUSSIAN_SYSTEM =
  "Rewrite each line in natural Russian, the way a native speaker would write it in their own notes. " +
  "Keep names, brands and product terms (Notion, Instagram) as they are. Keep each line as short as it " +
  "is, and add nothing. Return JSON: {\"lines\": string[]}, one per line, in the same order.";

/* Short lines the sorter wrote (an action, a new Thread's name) take the
   note's own words, so a name like Аня is not turned into Анна. */
export const TO_RUSSIAN_FROM_NOTE_SYSTEM =
  "Rewrite each line in natural Russian, the way a native speaker would write it in their own notes. " +
  "Where the note has a word or name for the same thing, use it exactly as the note writes it " +
  "(Аня stays Аня). Keep brands and product terms (Notion, Instagram) as they are. Keep each line as " +
  "short as it is, and add nothing. Return JSON: {\"lines\": string[]}, one Russian line per line " +
  "given, in the same order.";

export const ToRussianSchema = z.object({ lines: z.array(z.string()) });

/** One Russian line per original, each actually Russian and not much longer;
 * otherwise nothing is replaced. */
export function acceptRussian(originals: string[], answer: unknown): string[] | null {
  const parsed = ToRussianSchema.safeParse(answer);
  if (!parsed.success || parsed.data.lines.length !== originals.length) return null;
  /* A list number the model copied in ("1. Личное") is not part of the line. */
  const lines = parsed.data.lines.map((line, index) =>
    /^\s*\d+[.)]\s/.test(originals[index]) ? line.trim() : line.trim().replace(/^\d+[.)]\s*/, ""));
  const ok = lines.every((line, index) =>
    line && CYRILLIC.test(line) && line.length <= originals[index].length * 2 + 20);
  return ok ? lines : null;
}
