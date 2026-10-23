import { z } from "zod";
import type { CaptureEntry } from "./ledger";
import type { VoiceReading } from "./model";

/**
 * Your voice: how you talk, read from the words you actually said — never
 * the tidied versions, which would sand it away. It appears on The Record
 * once there is enough to hear (no counter before then), reads itself again
 * as you say more, and travels with your notes to an agent so what it
 * writes for you sounds like you.
 */

/** Enough to hear a voice: about forty minutes of talking. */
export const VOICE_MIN_WORDS = 5_000;
/** Read again once this much more has been said since the last reading. */
export const VOICE_GROWTH = 1.25;
/** What one reading looks at: spread across time, not just the latest. */
export const VOICE_SAMPLE_WORDS = 9_000;

const wordsIn = (text: string) => text.match(/[\p{L}\p{N}'’-]+/gu)?.length ?? 0;

/* Pasted documents (a list an agent wrote, an article) are not how someone
   talks: several heading or list lines give them away. So does great length. */
const looksPasted = (text: string) =>
  text.split("\n").filter((line) => /^\s*(#{1,6}\s|[-*•]\s|\d+[.)]\s)/.test(line)).length >= 3 ||
  wordsIn(text) > 1_500;

/** Each capture's own words once, oldest first. */
export function spokenNotes(ledger: CaptureEntry[]): { at: number; text: string }[] {
  const seen = new Set<string>();
  const notes: { at: number; text: string }[] = [];
  for (const entry of [...ledger].sort((a, b) => a.at - b.at)) {
    const text = (entry.transcript || entry.raw || "").trim();
    const key = entry.captureId || text;
    if (!text || seen.has(key)) continue;
    seen.add(key);
    if (wordsIn(text) < 6 || looksPasted(text)) continue;
    notes.push({ at: entry.at, text });
  }
  return notes;
}

export const spokenWords = (notes: { text: string }[]) => notes.reduce((sum, note) => sum + wordsIn(note.text), 0);

/** Whether a (new) reading is due: first at the bar, then as the words grow. */
export function voiceDue(voice: VoiceReading | undefined, words: number): boolean {
  if (words < VOICE_MIN_WORDS) return false;
  /* A reading from before viewpoint existed is read once more. */
  return !voice || !voice.viewpoint || words >= voice.words * VOICE_GROWTH;
}

/** Notes spread evenly across time until the budget is spent. */
export function voiceSample(notes: { text: string }[], budget = VOICE_SAMPLE_WORDS): string {
  const stride = Math.max(1, Math.ceil(spokenWords(notes) / budget));
  const picked: string[] = [];
  let used = 0;
  for (let index = 0; index < notes.length && used < budget; index += stride) {
    picked.push(notes[index].text);
    used += wordsIn(notes[index].text);
  }
  return picked.join("\n\n---\n\n");
}

export const VOICE_SYSTEM =
  "Below are someone's own notes, mostly spoken aloud and transcribed, separated by ---. Describe how " +
  "this person talks and thinks, so an AI can write in their voice and they recognise themselves in it. Listen for " +
  "how they open a thought, how long their sentences run, the small words they lean on, how they correct " +
  "themselves, and how they land. Return JSON {\"patterns\": string[], \"phrases\": string[], " +
  "\"samples\": [{\"about\": string, \"text\": string}], \"viewpoint\": [{\"claim\": string, \"words\": string}], " +
  "\"onThePage\": string[]}:\n" +
  "- patterns: 4 to 6 short plain sentences starting with \"You\" (speaking to this person), each one " +
  "something you can actually see in many of the notes. Specific to this person; nothing that would be " +
  "true of anyone.\n" +
  "- phrases: up to 8 words or short phrases they really reach for, copied exactly as the notes write them.\n" +
  "- samples: 2 short new notes, 60 to 120 words each, written as this person in the first person (\"I\"), " +
  "the way they would say it out loud: their openers, their rhythm, their fillers. Each about one of the " +
  "subjects given; \"about\" is that subject. New sentences only, never copied from the notes.\n" +
  "- viewpoint: 3 to 6 things this person believes or argues again and again (about their work, building, " +
  "how to live), each {\"claim\": the position in one short plain sentence, \"words\": the exact phrase from " +
  "the notes where they say it}. Only positions you can see in several notes, never generic advice.\n" +
  "- onThePage: 3 to 5 short instructions for writing as this person rather than speaking: what of their " +
  "voice to keep on the page (directness, the words they use, how they argue) and which spoken habits to " +
  "drop (fillers, check-ins, restarts).\n" +
  "Write in the language the notes are in.";

export const VoiceSchema = z.object({
  patterns: z.array(z.string()),
  phrases: z.array(z.string()),
  samples: z.array(z.object({ about: z.string(), text: z.string() })),
  viewpoint: z.array(z.object({ claim: z.string(), words: z.string() })).optional(),
  onThePage: z.array(z.string()).optional(),
});

const normal = (text: string) => text.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ");

/* Ten words in a row from a real note means the sample copied it. */
function copies(text: string, source: string): boolean {
  const words = normal(text).match(/[\p{L}\p{N}']+/gu) ?? [];
  const haystack = ` ${(normal(source).match(/[\p{L}\p{N}']+/gu) ?? []).join(" ")} `;
  for (let index = 0; index + 10 <= words.length; index++) {
    if (haystack.includes(` ${words.slice(index, index + 10).join(" ")} `)) return true;
  }
  return false;
}

/** The reading, kept only where it holds up: patterns are required; a phrase
 * must really appear in the notes; a sample must be new and the right size. */
export function acceptVoice(answer: unknown, source: string, words: number, now: number): VoiceReading | null {
  const parsed = VoiceSchema.safeParse(answer);
  if (!parsed.success) return null;
  const patterns = parsed.data.patterns.map((line) => line.trim()).filter((line) => line.length >= 10 && line.length <= 200);
  if (patterns.length < 3) return null;
  const said = normal(source);
  const phrases = [...new Set(parsed.data.phrases.map((phrase) => phrase.trim()))]
    .filter((phrase) => phrase.length >= 2 && phrase.length <= 40 && said.includes(normal(phrase)))
    .slice(0, 8);
  const samples = parsed.data.samples
    .map(({ about, text }) => ({ about: about.trim().slice(0, 80), text: text.trim() }))
    .filter(({ about, text }) => about && wordsIn(text) >= 25 && wordsIn(text) <= 220 && !copies(text, source))
    .slice(0, 2);
  /* A belief counts only where the notes really say it. */
  const viewpoint = (parsed.data.viewpoint ?? [])
    .map(({ claim, words: quoted }) => ({ claim: claim.trim(), words: quoted.trim().replace(/^["“]|["”]$/g, "") }))
    .filter(({ claim, words: quoted }) => claim.length >= 10 && claim.length <= 160 && quoted.length >= 3 && quoted.length <= 200 &&
      said.includes(normal(quoted)))
    .slice(0, 6);
  const onThePage = (parsed.data.onThePage ?? []).map((line) => line.trim()).filter((line) => line.length >= 10 && line.length <= 180).slice(0, 5);
  return { patterns: patterns.slice(0, 6), phrases, samples, viewpoint, onThePage, words, at: now };
}

/** "How I talk", for an agent writing on this person's behalf. */
export function voiceForAgents(voice: VoiceReading | undefined, heading: string): string[] {
  if (!voice?.patterns.length) return [];
  return [
    heading,
    "",
    ...voice.patterns.map((pattern) => `- ${pattern}`),
    ...(voice.phrases.length ? ["", voice.phrases.map((phrase) => `“${phrase}”`).join(" · ")] : []),
    ...(voice.samples[0] ? ["", `> ${voice.samples[0].text.replace(/\n+/g, " ")}`] : []),
  ];
}
