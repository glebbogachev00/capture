import "server-only";

import { generateObject } from "ai";
import { TO_RUSSIAN_FROM_NOTE_SYSTEM, TO_RUSSIAN_SYSTEM, ToRussianSchema, acceptRussian, needsRussian } from "./language";
import type { SimpleSortItem } from "./simpleSort";
import type { Tier } from "./providers";

type Options = { tier: Tier; abortSignal?: AbortSignal };

/** The lines in Russian, or null when the answer cannot be trusted; throws
 * when the provider fails. The note they came from lets the rewrite reuse the
 * person's own words and names. */
export async function toRussian(lines: string[], { tier, abortSignal }: Options, note?: string): Promise<string[] | null> {
  const common = {
    model: tier.model,
    system: note ? TO_RUSSIAN_FROM_NOTE_SYSTEM : TO_RUSSIAN_SYSTEM,
    /* A JSON list, not a numbered one: numbers were copied into the names. */
    prompt: note
      ? `Translate these lines:\n${JSON.stringify(lines)}\n\nThe note they came from (for its words and names only, do not translate it):\n${note.slice(0, 4_000)}`
      : JSON.stringify(lines),
    providerOptions: tier.providerOptions,
    maxOutputTokens: 1_500,
    temperature: 0,
    maxRetries: 0 as const,
    abortSignal,
  };
  /* A provider error (rate limit, outage) is thrown, so withFallback tries
     the next provider; swallowing it here left English names whenever the
     first provider was busy. An answer that fails the check is just null. */
  const answer = tier.name === "cerebras"
    ? (await generateObject({ ...common, output: "no-schema" })).object
    : (await generateObject({ ...common, schema: ToRussianSchema })).object;
  return acceptRussian(lines, answer);
}

/** A Russian capture keeps Russian in what the sorter wrote itself: actions
 * and new Thread names. One call for all of them; on any failure everything
 * stays as the sorter wrote it. */
export async function inCaptureLanguage(items: SimpleSortItem[], raw: string, options: Options): Promise<SimpleSortItem[]> {
  const english = new Set<string>();
  for (const item of items) {
    if (item.kind === "action" && needsRussian(raw, item.text)) english.add(item.text);
    for (const target of item.threads ?? []) if ("name" in target && needsRussian(raw, target.name)) english.add(target.name);
  }
  if (!english.size) return items;
  const originals = [...english];
  const russian = await toRussian(originals, options, raw);
  if (!russian) return items;
  const swap = new Map(originals.map((line, index) => [line, russian[index]]));
  return items.map((item) => ({
    ...item,
    ...(item.kind === "action" ? { text: swap.get(item.text) ?? item.text } : {}),
    ...(item.threads ? { threads: item.threads.map((target) => "name" in target ? { name: swap.get(target.name) ?? target.name } : target) } : {}),
  }));
}
