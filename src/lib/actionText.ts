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
/* Word forms count as the same word: methods/method, selecting/select, enabling/enable, weekly/week.
   Russian changes its endings far more (выставку/выставке, новую/новой), so a
   Russian word is matched on its first three letters. */
const stem = (word: string) => {
  if (/[\u0400-\u04ff]/.test(word)) return word.replace(/ё/g, "е").slice(0, 3);
  const bare = word.replace(/['’]s$/, "");
  return bare.length > 4 ? bare.replace(/(ing|ed|es|ly|s)$/, "").replace(/e$/, "") : bare.replace(/(?<=..)e$/, "");
};
const SMALL = new Set([
  "a", "an", "the", "and", "or", "to", "for", "of", "on", "in", "with", "my", "it", "its", "be", "is",
  "и", "в", "во", "на", "с", "со", "к", "ко", "по", "для", "о", "об", "у", "из", "от", "до", "за", "а", "мой", "моя", "мои",
]);

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
const POINTS_BACK = new Set(["it", "them", "this", "that", "это", "этого"]);
/* Russian "it"/"them"/"there": отправить его Ане, перенести туда заметки. */
const LEANS = new Set(["it", "them", "его", "её", "ее", "их", "туда"]);
export function pointsBack(item: SimpleSortItem): boolean {
  if (item.kind !== "action" || item.existingActionId) return false;
  const own: string[] = words(item.text);
  return own.length >= 2 && own.length <= 8
    && (own.some((word) => LEANS.has(word)) || POINTS_BACK.has(own.at(-1)!));
}

export const NAME_IT_SYSTEM =
  "This to-do item came from the note below, but a word in it like \"it\" or \"them\" only " +
  "makes sense with the note. Rewrite just this one item, in at most eight words, so it says " +
  "what that word means. Use the note's own words, in the note's language; leave out every " +
  "other task in the note. Return JSON: {\"task\": string}.";

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

/* Several actions from one capture are read one at a time on a list, but the
   sorter writes them as a set: context said once ("on X", "for TechBash")
   stays on the first line, a detail ("use the book as a reference") becomes a
   line of its own, and a task said twice is listed twice. One small call
   rewrites the set so each line stands alone. */
export const needsContext = (items: SimpleSortItem[]) =>
  items.filter((item) => item.kind === "action" && !item.existingActionId).length >= 2;

export const IN_CONTEXT_SYSTEM =
  "These to-do items were written from the note below. Each will be read on its own on a list, " +
  "without the note. Rewrite them so each one stands alone:\n" +
  "- Context the note gives once (where, for which project, about what) goes into every item it " +
  "applies to: \"Post an article on X about running\" and \"Post an article on X about manifestation\".\n" +
  "- An item that only adds a detail to another item (a reference to use, who to include) is " +
  "folded into that item.\n" +
  "- Two items that are the same task become one.\n" +
  "- An item that is not a task still to do (already done, or a filler phrase) is dropped.\n" +
  "Never add a task, and never drop a real one. Use the note's own words, in the note's language; " +
  "each item is a short imperative of at most twelve words. Return JSON: {\"tasks\": [{\"text\": " +
  "string, \"from\": number[]}], \"dropped\": number[]}: from lists the numbers of the items each " +
  "task came from, and dropped the numbers of the items left out. Every number appears once.";

export const InContextSchema = z.object({
  tasks: z.array(z.object({ text: z.string(), from: z.array(z.number()) })).min(1).max(12),
  dropped: z.array(z.number()),
});

export const inContextPrompt = (note: string, items: string[]) =>
  `Note: ${note}\n\nItems:\n${items.map((text, index) => `${index + 1}. ${text}`).join("\n")}`;

/** The rewritten set may only use the note's words (or a spelling fix of
 * one), each line short, never more lines than before. Every item must be
 * accounted for, kept or named as dropped, and at most half are dropped;
 * otherwise the actions stay as the sorter wrote them. */
export function acceptInContext(
  note: string,
  items: string[],
  tasks: { text: string; from: number[] }[],
  dropped: number[] = [],
): { text: string; from: number[] }[] | null {
  if (!tasks.length || tasks.length > items.length) return null;
  const source = new Set([...words(note), ...items.flatMap(words)].map(stem));
  const known = (word: string) => SMALL.has(word) || source.has(stem(word)) || spelledLike(word, source);
  const kept = new Set<number>();
  const out: { text: string; from: number[] }[] = [];
  for (const task of tasks) {
    const clean = task.text.trim().replace(/\s+/g, " ").replace(/\.+$/, "");
    const own = words(clean);
    if (own.length < 2 || own.length > ACTION_WORD_LIMIT) return null;
    if (!own.every(known)) return null;
    const from = [...new Set(task.from.map((n) => n - 1))].filter((index) => Number.isInteger(index) && index >= 0 && index < items.length);
    if (!from.length) return null;
    from.forEach((index) => kept.add(index));
    out.push({ text: clean.charAt(0).toUpperCase() + clean.slice(1), from });
  }
  const left = new Set(dropped.map((n) => n - 1));
  if (!items.every((_, index) => kept.has(index) || left.has(index))) return null;
  return kept.size * 2 >= items.length ? out : null;
}

/* "Intention" for a typed "Intetion": a word of five letters or more, one or
   two letters off a word the note has, starting with the same letter. */
function spelledLike(word: string, source: Set<string>): boolean {
  if (word.length < 5) return false;
  for (const known of source) {
    if (known[0] !== word[0] || Math.abs(known.length - word.length) > 2 || known.length < 4) continue;
    if (distance(stem(word), known) <= 2) return true;
  }
  return false;
}

function distance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    row = next;
  }
  return row[b.length];
}

/** Put the rewritten actions where the first one stood. Each keeps the due
 * date of the first item it came from that had one; a repeat of an existing
 * action was never sent and stays as it is. */
export function placeInContext(
  items: SimpleSortItem[],
  tasks: { text: string; from: number[] }[],
): SimpleSortItem[] {
  const sent = items.filter((item) => item.kind === "action" && !item.existingActionId);
  const rewritten: SimpleSortItem[] = tasks.map((task) => {
    const due = task.from.map((index) => sent[index]?.due).find(Boolean);
    return { kind: "action", text: task.text, ...(due ? { due } : {}) };
  });
  const at = items.indexOf(sent[0]);
  const rest = items.filter((item) => !sent.includes(item));
  const before = items.slice(0, at).filter((item) => !sent.includes(item)).length;
  return [...rest.slice(0, before), ...rewritten, ...rest.slice(before)];
}
