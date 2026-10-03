import "server-only";

import { generateObject } from "ai";
import { SPLIT_ACTION_SYSTEM, SplitActionSchema, acceptTasks, isRunOnAction, splitActions } from "./actionText";
import type { SimpleSortItem } from "./simpleSort";
import type { Tier } from "./providers";

/** Only run-on actions are sent, one small call each; anything that fails or
 * does not pass acceptTasks stays exactly as the sorter wrote it. */
export async function tightenActions(
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
