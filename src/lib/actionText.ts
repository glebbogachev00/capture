import { z } from "zod";
import type { SimpleSortItem } from "./simpleSort";

/**
 * An action is one line on a list. When the sorter writes a run-on action
 * ("Create an account, set up the integration, configure automation, and
 * assign a personality"), it is split into its separate tasks, each a short
 * imperative. The whole capture stays attached to every action, so no detail
 * is lost by keeping the line short.
 */

export const ACTION_WORD_LIMIT = 12;

export const isRunOnAction = (item: SimpleSortItem) =>
  item.kind === "action" && item.text.trim().split(/\s+/).length > ACTION_WORD_LIMIT;

export const SPLIT_ACTION_SYSTEM =
  "This is one item from someone's to-do list, and it is too long. If it holds several " +
  "separate tasks, list each one; if it is one task, give just that one. Each task is a " +
  "short imperative of at most ten words, using the item's own words: drop reasons, " +
  "explanations and examples, never add anything. Return JSON: {\"tasks\": string[]} with " +
  "at most four tasks.";

export const SplitActionSchema = z.object({ tasks: z.array(z.string()).min(1).max(4) });

const words = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
/* Word forms count as the same word: methods/method, selecting/select, enabling/enable, weekly/week. */
const stem = (word: string) => word.length > 4 ? word.replace(/(ing|ed|es|ly|s)$/, "").replace(/e$/, "") : word;
const SMALL = new Set(["a", "an", "the", "and", "or", "to", "for", "of", "on", "in", "with", "my", "it", "its", "be", "is"]);

/** The tasks may only use the action's own words, each short and non-empty;
 * otherwise the action stays as it was. */
export function acceptTasks(original: string, tasks: string[]): string[] | null {
  const source = new Set(words(original).map(stem));
  const clean = tasks.map((task) => task.trim().replace(/\s+/g, " ").replace(/\.+$/, "")).filter(Boolean);
  if (!clean.length || clean.length > 4) return null;
  for (const task of clean) {
    const own = words(task);
    if (own.length < 2 || own.length > ACTION_WORD_LIMIT) return null;
    if (own.some((word) => !SMALL.has(word) && !source.has(stem(word)))) return null;
  }
  return clean.map((task) => task.charAt(0).toUpperCase() + task.slice(1));
}

/* A short action that leans on what only the capture explains: "Let Aside
   run it" or "Post it on X" mean nothing on a list without the task beside
   them. "This" and "that" count only as the last word ("check that the build
   passes" is fine). Long actions explain their own "it" ("allow them to post
   instead"), so they are left alone. */
const POINTS_BACK = new Set(["it", "them", "this", "that"]);
export function pointsBack(item: SimpleSortItem): boolean {
  if (item.kind !== "action" || item.existingActionId) return false;
  const own: string[] = words(item.text);
  return own.length >= 2 && own.length <= 8
    && (own.includes("it") || own.includes("them") || POINTS_BACK.has(own.at(-1)!));
}

export const NAME_IT_SYSTEM =
  "This to-do item came from the note below, but a word in it like \"it\" or \"them\" only " +
  "makes sense with the note. Rewrite just this one item, in at most eight words, so it says " +
  "what that word means. Use the note's own words; leave out every other task in the note. " +
  "Return JSON: {\"task\": string}.";

export const NameItSchema = z.object({ task: z.string() });

/** The rewrite may only use the note's words, must stay short, and must
 * actually name the thing; otherwise the action stays as written. */
export function acceptNamed(note: string, item: string, task: string): string | null {
  const source = new Set([...words(note), ...words(item)].map(stem));
  const clean = task.trim().replace(/\s+/g, " ").replace(/\.+$/, "");
  const own = words(clean);
  if (own.length < 2 || own.length > ACTION_WORD_LIMIT) return null;
  if (own.some((word) => !SMALL.has(word) && !source.has(stem(word)))) return null;
  if (pointsBack({ kind: "action", text: clean })) return null;
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

/** Replace each run-on action with its tasks. Tasks inherit the due date; a
 * repeat of an existing action stays a single line. */
export function splitActions(
  items: SimpleSortItem[],
  tasksFor: Map<SimpleSortItem, string[]>,
): SimpleSortItem[] {
  return items.flatMap((item) => {
    const tasks = tasksFor.get(item);
    if (!tasks) return [item];
    if (item.existingActionId) return [{ ...item, text: tasks[0] }];
    return tasks.map((text) => ({ kind: "action" as const, text, ...(item.due ? { due: item.due } : {}) }));
  });
}
