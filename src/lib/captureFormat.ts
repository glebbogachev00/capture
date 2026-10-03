import { CLEANUP_SYSTEM } from "./dictationCleanup";

/**
 * Every capture lands readable, however it was typed or dictated: speech
 * artifacts removed (the existing dictation-cleanup contract, unchanged) and
 * laid out in paragraphs and lists. The words that were actually captured stay
 * in the record; this only changes what the Thread shows.
 *
 * Cost stays small by doing nothing when there is nothing to do: short
 * captures and text that already has structure are never sent. Any failure,
 * and any answer that looks like it dropped or invented content, keeps the
 * capture exactly as it was.
 */

export const FORMAT_SYSTEM =
  CLEANUP_SYSTEM.replace(/ Reply with the cleaned text only, no commentary\.$/, "") +
  " Then lay the text out for rereading: put a blank line between distinct ideas, " +
  "and put '- ' bullets on their own lines where the speaker lists things. Line " +
  "breaks and '- ' markers are the only things you may add. No headings, no bold, " +
  "no emphasis. Reply with the formatted text only, no commentary.";

const FILLER = /\b(um+|uh+|erm|you know)\b/i;
const STRUCTURED = /\n\s*\n|^\s*([-*•]|\d+[.)]|#{1,3})\s/m;

/** Worth a model call: long enough to need paragraphs, or carrying filler,
 * and not already laid out by whoever wrote it. */
export function shouldFormat(raw: string): boolean {
  const text = raw.trim();
  if (!text || text.length > 20_000 || STRUCTURED.test(text)) return false;
  return text.length >= 160 || FILLER.test(text);
}

const words = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
const FILLER_WORDS = new Set(["um", "umm", "uh", "uhh", "erm", "like", "you", "know", "so", "just", "i", "mean"]);

/** Cleanup may remove fillers, restarts and corrected-away words; it may not
 * summarise or add. Measured on the words themselves, not on the layout. */
export function keepsTheWords(raw: string, formatted: string): boolean {
  const before = words(raw);
  const after = words(formatted);
  if (!after.length) return false;
  const afterSet = new Set(after);
  const beforeSet = new Set(before);
  const content = before.filter((word) => !FILLER_WORDS.has(word));
  const kept = content.filter((word) => afterSet.has(word)).length / Math.max(1, content.length);
  const invented = after.filter((word) => !beforeSet.has(word)).length / after.length;
  return kept >= 0.85 && invented <= 0.03 && after.length >= before.length * 0.6;
}
