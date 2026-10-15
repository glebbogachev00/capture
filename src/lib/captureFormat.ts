import { z } from "zod";
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

/* Russian fillers too; \b does not see Cyrillic letters, so look for letters around. */
const FILLER = /\b(um+|uh+|erm|you know)\b|(?<!\p{L})(ну|короче|типа|э+|м+|как бы|это самое)(?!\p{L})/iu;
const STRUCTURED = /\n\s*\n|^\s*([-*•]|\d+[.)]|#{1,3})\s/m;

/** Worth a model call: long enough to need paragraphs, or carrying filler,
 * and not already laid out by whoever wrote it. */
export function shouldFormat(raw: string): boolean {
  const text = raw.trim();
  if (!text || text.length > 20_000 || STRUCTURED.test(text)) return false;
  return text.length >= 160 || FILLER.test(text);
}

/* "ещё" and "еще" are one word written two ways; counting them apart rejected
   good Russian cleanups as invented words. */
const words = (text: string) => text.toLowerCase().replace(/ё/g, "е").match(/[\p{L}\p{N}']+/gu) ?? [];
const FILLER_WORDS = new Set([
  "um", "umm", "uh", "uhh", "erm", "like", "you", "know", "so", "just", "i", "mean",
  "ну", "короче", "типа", "вот", "как", "бы", "эээ", "ммм", "это", "самое",
]);

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
  for (let paragraph of text.split(/\n{2,}/)) {
    /* A heading stays on its own line, never joined to a paragraph. */
    const heading = paragraph.match(/^#{1,3}\s+[^\n]+/);
    if (heading) {
      blocks.push({ list: true, parts: [heading[0]] });
      paragraph = paragraph.slice(heading[0].length).trim();
      if (!paragraph) continue;
    }
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
    .replace(/(^(?:#{1,3}\s+)?|[.!?]["”’')\]]*\s+|\n\s*(?:[-*•]\s+|#{1,3}\s+)?)([a-zа-яё])/g, (match: string, before: string, letter: string, offset: number, all: string) =>
      /\b(e\.g|i\.e|etc|vs|cf|approx)\.\s+$/i.test(all.slice(Math.max(0, offset - 8), offset) + before) ? match : before + letter.toUpperCase())
    .replace(/\bi(?=\b(?:'(?:m|ve|ll|d))?(?![\p{L}\p{N}.\/-]))/gu, "I");
}

/** For Format on older notes: still worth sending only if it has filler or is
 * long enough to need paragraphs. A short note that is already a fine single
 * paragraph is left alone, so one press of Format is enough and pressing it
 * again never re-sends the same notes. */
export function needsFormatting(text: string): boolean {
  if (!shouldFormat(text)) return false;
  const one = text.trim();
  return FILLER.test(one) || sentences(one).length > 3 || wordCount(one) > 60;
}


/* Headings: a long note that moves through several parts gets a short
   heading at each one, like a well-written long post. The model only names
   the parts; code puts the headings between paragraphs, so not one of the
   note's own words can change. */

export const HEADINGS_MIN_WORDS = 220;

const blocksOf = (text: string) => text.trim().split(/\n{2,}/);

/** Long, laid out in paragraphs, and not headed yet. */
export function needsHeadings(text: string): boolean {
  if (/^#{1,3}\s+\S/m.test(text) || wordCount(text) < HEADINGS_MIN_WORDS) return false;
  return blocksOf(text).length >= 4;
}

export const HEADINGS_SYSTEM =
  "Below is one note, split into numbered paragraphs. If it moves through several distinct parts, name " +
  "each part with a short heading, the way a well-written long post would. Return JSON " +
  "{\"headings\": [{\"before\": number, \"title\": string}]}: \"before\" is the number of the paragraph " +
  "where that part starts, and the first part starts at 1. Each part is at least two paragraphs. Titles " +
  "are 1 to 5 words, plain, sentence case, no punctuation at the end, in the note's language, naming " +
  "what that part is about in the writer's own terms. If the note is really one thought, return " +
  "{\"headings\": []}.";

/** The note with numbered paragraphs, for HEADINGS_SYSTEM. */
export const numberedParagraphs = (text: string) => blocksOf(text).map((block, index) => `[${index + 1}] ${block}`).join("\n\n");

const HeadingsSchema = z.object({
  headings: z.array(z.object({ before: z.number(), title: z.string() })),
});

/** The headings that hold up, placed between the note's paragraphs: short
 * plain titles, at least two paragraphs to a part, the first part near the
 * top, and at least two parts. Anything less leaves the note as it was. */
export function placeHeadings(text: string, answer: unknown): string {
  const parsed = HeadingsSchema.safeParse(answer);
  if (!parsed.success) return text;
  const blocks = blocksOf(text);
  const titles = new Map<number, string>();
  for (const { before, title } of parsed.data.headings) {
    const index = before - 1;
    const clean = sentenceCase(title.trim().replace(/^#+\s*/, "").replace(/[.:;,!]+$/, ""));
    if (!Number.isInteger(index) || index < 0 || index > blocks.length - 2) continue;
    if (!clean || clean.length > 48 || wordCount(clean) > 6 || /[*_#`[\]<>\n]/.test(clean)) continue;
    if (!titles.has(index)) titles.set(index, clean);
  }
  const starts: number[] = [];
  for (const start of [...titles.keys()].sort((a, b) => a - b)) {
    if (!starts.length || start - starts.at(-1)! >= 2) starts.push(start);
  }
  if (starts.length < 2 || starts[0] > 2) return text;
  return blocks.flatMap((block, index) => (starts.includes(index) ? [`### ${titles.get(index)}`, block] : [block])).join("\n\n");
}

/** The first JSON object in a model's answer, or null. */
export function firstJsonObject(answer: string): unknown {
  const start = answer.indexOf("{");
  const end = answer.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(answer.slice(start, end + 1));
  } catch {
    return null;
  }
}
