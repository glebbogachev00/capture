import "server-only";

import { generateText } from "ai";
import { FORMAT_SYSTEM, airy, keepsTheWords } from "./captureFormat";
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
  return airy(formatted && keepsTheWords(raw, formatted) ? formatted : raw.trim());
}
