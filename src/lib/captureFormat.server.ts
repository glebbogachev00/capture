import "server-only";

import { generateText } from "ai";
import {
  FORMAT_SYSTEM, HEADINGS_SYSTEM, airy, firstJsonObject, keepsTheWords, needsHeadings, numberedParagraphs,
  placeHeadings, sentenceCase,
} from "./captureFormat";
import type { Tier } from "./providers";

/** One model pass: clean up and lay out, then keep it only if the words survived. */
export async function formatCapture(raw: string, { tier, abortSignal }: { tier: Tier; abortSignal?: AbortSignal }): Promise<string> {
  const { text } = await generateText({
    model: tier.model,
    system: FORMAT_SYSTEM,
    prompt: raw,
    providerOptions: tier.providerOptions,
    maxOutputTokens: Math.min(12_000, Math.ceil(raw.length / 2) + 1_000),
    temperature: 0,
    maxRetries: 0,
    abortSignal,
  });
  const formatted = text.trim().replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n");
  /* A doubtful cleanup keeps the words as captured; they still get short
     paragraphs, since splitting changes only line breaks. */
  return airy(sentenceCase(formatted && keepsTheWords(raw, formatted) ? formatted : raw.trim()));
}

/** Headings for a long note: the model names the parts, code places them.
 * Runs on a note as it will sit in its thread, after sorting, so a heading
 * never travels apart from the part it names. */
export async function headCapture(text: string, { tier, abortSignal }: { tier: Tier; abortSignal?: AbortSignal }): Promise<string> {
  if (!needsHeadings(text)) return text;
  const { text: answer } = await generateText({
    model: tier.model,
    system: HEADINGS_SYSTEM,
    prompt: numberedParagraphs(text),
    providerOptions: tier.providerOptions,
    maxOutputTokens: 4_000,
    temperature: 0,
    maxRetries: 0,
    abortSignal,
  });
  return placeHeadings(text, firstJsonObject(answer));
}
