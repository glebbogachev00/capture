import "server-only";

import { generateObject } from "ai";
import {
  NAME_IT_SYSTEM, NameItSchema, SPLIT_ACTION_SYSTEM, SplitActionSchema, acceptNamed, acceptTasks, isRunOnAction, pointsBack, splitActions,
} from "./actionText";
import type { SimpleSortItem } from "./simpleSort";
import type { Tier } from "./providers";

/** Only run-on actions are sent, one small call each; anything that fails or
 * does not pass acceptTasks stays exactly as the sorter wrote it. Then an
 * action that ends on "it" gets one small call to say what "it" is. */
export async function tightenActions(
  items: SimpleSortItem[],
  { tier, abortSignal, raw }: { tier: Tier; abortSignal?: AbortSignal; raw?: string },
): Promise<SimpleSortItem[]> {
  const split = await splitRunOns(items, { tier, abortSignal });
  return raw ? nameWhatItIs(split, { tier, abortSignal, raw }) : split;
}

async function splitRunOns(
  items: SimpleSortItem[],
  { tier, abortSignal }: { tier: Tier; abortSignal?: AbortSignal },
): Promise<SimpleSortItem[]> {
  const runOns = items.filter(isRunOnAction);
  if (!runOns.length) return items;
  const tasksFor = new Map<SimpleSortItem, string[]>();
  await Promise.all(runOns.map(async (item) => {
    try {
      const common = {
        model: tier.model,
        system: SPLIT_ACTION_SYSTEM,
        prompt: item.text,
        providerOptions: tier.providerOptions,
        maxOutputTokens: 1_500,
        temperature: 0,
        maxRetries: 0 as const,
        abortSignal,
      };
      const answer = tier.name === "cerebras"
        ? (await generateObject({ ...common, output: "no-schema" })).object
        : (await generateObject({ ...common, schema: SplitActionSchema })).object;
      const parsed = SplitActionSchema.safeParse(answer);
      const tasks = parsed.success ? acceptTasks(item.text, parsed.data.tasks) : null;
      if (tasks) tasksFor.set(item, tasks);
    } catch {
      /* Keep the action as written. */
    }
  }));
  return splitActions(items, tasksFor);
}

async function nameWhatItIs(
  items: SimpleSortItem[],
  { tier, abortSignal, raw }: { tier: Tier; abortSignal?: AbortSignal; raw: string },
): Promise<SimpleSortItem[]> {
  if (!items.some(pointsBack)) return items;
  return Promise.all(items.map(async (item) => {
    if (!pointsBack(item)) return item;
    try {
      const common = {
        model: tier.model,
        system: NAME_IT_SYSTEM,
        prompt: `Note: ${raw}\n\nItem: ${item.text}`,
        providerOptions: tier.providerOptions,
        maxOutputTokens: 1_000,
        temperature: 0,
        maxRetries: 0 as const,
        abortSignal,
      };
      const answer = tier.name === "cerebras"
        ? (await generateObject({ ...common, output: "no-schema" })).object
        : (await generateObject({ ...common, schema: NameItSchema })).object;
      const parsed = NameItSchema.safeParse(answer);
      const text = parsed.success ? acceptNamed(raw, item.text, parsed.data.task) : null;
      return text ? { ...item, text } : item;
    } catch {
      return item; /* Keep the action as written. */
    }
  }));
}
