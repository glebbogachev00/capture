import "server-only";

import { generateText } from "ai";
import { firstJsonObject } from "./captureFormat";
import { FILE_SYSTEM, acceptFiling, filingPrompt } from "./secondLook";
import type { Tier } from "./providers";
import type { SimpleSortItem } from "./simpleSort";

type Brief = { id: string; name: string; about: string };
type FilingContext = { threads: Brief[]; latest: Record<string, string> };

/** Which existing thread one thought continues, or null to keep the new one. */
export async function fileThought(
  note: string,
  raw: string,
  context: FilingContext,
  { tier, abortSignal }: { tier: Tier; abortSignal?: AbortSignal },
): Promise<string | null> {
  const { text } = await generateText({
    model: tier.model,
    system: FILE_SYSTEM,
    prompt: filingPrompt(note, raw, context.threads, context.latest),
    providerOptions: tier.providerOptions,
    maxOutputTokens: 3_000,
    temperature: 0,
    maxRetries: 0,
    abortSignal,
  });
  return acceptFiling(firstJsonObject(text), context.threads);
}

/** A thought about to start a new thread gets the second look; everything
 * else, and any failure, stays as the sort left it. */
export async function fileThoughts(
  items: SimpleSortItem[],
  context: FilingContext,
  file: (note: string) => Promise<string | null>,
): Promise<SimpleSortItem[]> {
  if (!context.threads.length) return items;
  return Promise.all(items.map(async (item) => {
    const target = item.threads?.[0];
    if (item.kind !== "thought" || !target || "id" in target) return item;
    const id = await file(item.text).catch(() => null);
    return id ? { ...item, threads: [{ id }] } : item;
  }));
}
