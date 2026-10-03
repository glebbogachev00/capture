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
  " Then lay the text out for rereading, like a well-written long post: short " +
  "paragraphs of two or three sentences with a blank line between them, breaking " +
  "where the thought turns. Use '- ' bullets only when the speaker names several " +
  "separate items in a row; ordinary sentences stay in paragraphs. Never one long " +
  "block, but don't leave single sentences on their " +
  "own unless they stand alone as a point. Line " +
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

/* A sentence ends at . ! or ? followed by a space, so links and decimals stay whole. */
const sentences = (paragraph: string) =>
  paragraph.split(/(?<=[.!?]["”’')\]]*)\s+/).map((sentence) => sentence.trim()).filter(Boolean);
const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;

/** Short paragraphs, guaranteed, like a well-written long post: two or three
 * sentences each. Long paragraphs are split at sentence ends; a sentence left
 * on its own joins its neighbour when the pair still fits. Lists stay as they
 * are. Only line breaks change, never words. */
export function airy(text: string): string {
  type Block = { list: boolean; parts: string[] };
  const fits = (parts: string[]) => parts.length <= 3 && wordCount(parts.join(" ")) <= 60;
  const blocks: Block[] = [];
  for (const paragraph of text.split(/\n{2,}/)) {
    if (/^\s*([-*•]|\d+[.)])\s/m.test(paragraph)) { blocks.push({ list: true, parts: [paragraph] }); continue; }
    const parts = sentences(paragraph.replace(/\s*\n\s*/g, " "));
    // Split anything long into groups of two or three sentences.
    let group: string[] = [];
    for (const sentence of parts) {
      if (group.length >= 2 && !fits([...group, sentence])) { blocks.push({ list: false, parts: group }); group = []; }
      group.push(sentence);
    }
    if (group.length) blocks.push({ list: false, parts: group });
  }
  // Join a lone sentence to its neighbour when they still fit together.
  const out: Block[] = [];
  for (const block of blocks) {
    const previous = out.at(-1);
    if (previous && !previous.list && !block.list && (block.parts.length === 1 || previous.parts.length === 1)
        && fits([...previous.parts, ...block.parts])) {
      previous.parts.push(...block.parts);
    } else {
      out.push({ list: block.list, parts: [...block.parts] });
    }
  }
  // A last sentence left alone after a full paragraph takes one from it.
  const last = out.at(-1);
  const before = out.at(-2);
  if (last && before && !last.list && !before.list && last.parts.length === 1 && before.parts.length === 3) {
    last.parts.unshift(before.parts.pop()!);
  }
  return out.map((block) => block.parts.join(" ")).join("\n\n");
}

/** Capital letters where a sentence starts and for a standalone "i", for
 * captures typed or dictated in lowercase. Letters only, never words; a word
 * that is already capitalised or mixed-case is left as it is. */
export function sentenceCase(text: string): string {
  return text
    .replace(/(^|[.!?]["”’')\]]*\s+|\n\s*(?:[-*•]\s+)?)([a-z])/g, (match: string, before: string, letter: string, offset: number, all: string) =>
      /\b(e\.g|i\.e|etc|vs|cf|approx)\.\s+$/i.test(all.slice(Math.max(0, offset - 8), offset) + before) ? match : before + letter.toUpperCase())
    .replace(/\bi(?=\b(?:'(?:m|ve|ll|d))?(?![\p{L}\p{N}.\/-]))/gu, "I");
}

