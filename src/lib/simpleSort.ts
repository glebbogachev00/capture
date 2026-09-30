import { generateObject } from "ai";
import { z } from "zod";
import type { Tier } from "./providers";

/**
 * The sorter: one capture, one model call, a short list of items.
 *
 * The model reads the capture and the Threads and says what is in it. The
 * code only checks names and ids. The person's exact words are never at risk:
 * the whole capture is kept on its record ("said"), so an item's text can be
 * the model's clean version of its part instead of a byte-exact slice.
 */

export const SIMPLE_SORT_VERSION = 2;

/** What the model is asked for. */
export const SimpleSortSchema = z.object({
  items: z.array(z.object({
    kind: z.enum(["action", "thought", "intention"]),
    text: z.string(),
    threadId: z.string().nullable(),
    newThread: z.string().nullable(),
    due: z.string().nullable(),
  })).min(1).max(12),
});

/** What is accepted back: a model may leave out a null field. */
const Answer = z.object({
  items: z.array(z.object({
    kind: z.enum(["action", "thought", "intention"]),
    text: z.string().trim().min(1).max(8000),
    threadId: z.string().max(100).nullish(),
    newThread: z.string().trim().max(100).nullish(),
    due: z.string().max(40).nullish(),
  })).min(1).max(12),
});

export type SimpleSortItem = {
  kind: "action" | "thought" | "intention";
  text: string;
  /** Thoughts only: an existing Thread id, or a new Thread's name. */
  thread?: { id: string } | { name: string };
  /** Actions only: ISO date as the model resolved it. */
  due?: string;
};

/** Today and the next seven days in the person's own timezone, named, so
 * no weekday is ever computed. tzOffset is Date#getTimezoneOffset(). */
export function calendar(now: number, tzOffset = 0): string {
  const day = (offset: number) => {
    const date = new Date(now - tzOffset * 60_000 + offset * 86_400_000);
    const iso = date.toISOString().slice(0, 10);
    const name = date.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
    return `${offset === 0 ? "today" : offset === 1 ? "tomorrow" : name}: ${name} ${iso}`;
  };
  return Array.from({ length: 8 }, (_, offset) => day(offset)).join("\n");
}

type ThreadBrief = { id: string; name: string; about: string };
type Correction = { capture: string; kind: string; threadId?: string; threadName?: string };
type Force = "action" | "thread" | "intention";

export function simpleSortPrompt(input: {
  raw: string;
  threads: ThreadBrief[];
  corrections?: Correction[];
  force?: Force;
  now?: number;
  tzOffset?: number;
}): string {
  const corrections = (input.corrections ?? []).map((example) =>
    `- "${example.capture}" → ${example.kind === "thread" ? `thought in ${example.threadName ?? example.threadId}` : example.kind}`
  ).join("\n");
  return [
    "You sort one capture from someone's personal notes app. Say what is in it.",
    'Return one JSON object: {"items":[{"kind":"thought"|"action"|"intention","text":string,"threadId":string|null,"newThread":string|null,"due":string|null}]}',
    "",
    "KINDS",
    "- thought: an idea, observation, question, opinion, plan being thought through, bug report, complaint, reference or lesson. Every thought goes to a Thread.",
    "- action: a concrete task the person means to do (\"email Mia\", \"check the heater Friday\"). A wish, a \"should\", a general resolve (\"I will build\") or a requirement for a product is not an action; it is part of the thought around it.",
    "- intention: a chosen way of being or living, declared as their own (\"I rest without guilt\"). Only when the whole capture is that declaration, or when they explicitly call a part an intention (\"my intention\", \"an intention for how I live\"). A part they call an intention is its own intention item, without the label: \"Fix the login. An intention for how I live: I say no easily.\" → an action \"Fix the login\" and an intention \"I say no easily.\" Never pull an unlabeled intention out of a longer thought.",
    "",
    "SPLITTING",
    "Keep the capture as ONE item unless it clearly holds separate things: a different subject, or a task beside thoughts. Never split a sentence or one line of reasoning. A long rant or bug report about one subject is one thought.",
    "",
    "TEXT",
    "Use the person's own words for that item: fix obvious dictation slips and drop filler, but never summarize and keep every idea. For an action, a short imperative (\"Check the heater\"), without the date.",
    "",
    "THREADS",
    "For a thought, set threadId to the existing Thread it belongs in, judged by each Thread's description. Only if none fits, set threadId null and newThread to a short name.",
    "\"Add this to X\", \"put this in X\", \"create a new thread called X\" are filing instructions, not items: put the rest of the capture in X (its existing id, or newThread exactly X).",
    "",
    "DUE",
    "For an action with a stated day or date, due is the ISO date (YYYY-MM-DD); otherwise null. Tasks that share one deadline (\"By Friday I need to A, B and C\") each get that date. Look days up in this calendar; do not calculate them:",
    calendar(input.now ?? Date.now(), input.tzOffset),
    ...(input.force ? ["", `The person already chose: everything here is ${input.force === "thread" ? "a thought" : `an ${input.force}`}.`] : []),
    "",
    `Existing Threads:\n${JSON.stringify(input.threads.map(({ id, name, about }) => ({ id, name, about })))}`,
    ...(corrections ? ["", `This person corrected earlier sorts like this (follow the pattern, not the words):\n${corrections}`] : []),
    "",
    `Capture:\n${JSON.stringify(input.raw)}`,
  ].join("\n");
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/;
const nameKey = (name: string) => name.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();

/** Check the model's answer against the board. Throws when it cannot be used. */
export function normalizeSimpleSort(
  untrusted: unknown,
  context: { threads: { id: string; name: string }[]; force?: Force; raw?: string },
): SimpleSortItem[] {
  const { items } = Answer.parse(untrusted);
  const byId = new Map(context.threads.map((thread) => [thread.id, thread]));
  const byName = new Map(context.threads.map((thread) => [nameKey(thread.name), thread]));
  const out: SimpleSortItem[] = [];
  for (const item of items) {
    const kind = context.force === "thread" ? "thought" : context.force ?? item.kind;
    if (kind !== "thought") {
      const due = kind === "action" && item.due && ISO_DAY.test(item.due) ? item.due : undefined;
      out.push({ kind, text: item.text, ...(due ? { due } : {}) });
      continue;
    }
    const named = item.newThread ? byName.get(nameKey(item.newThread)) : undefined;
    const thread: SimpleSortItem["thread"] = item.threadId && byId.has(item.threadId)
      ? { id: item.threadId }
      : named
        ? { id: named.id }
        : item.newThread
          ? { name: item.newThread }
          : undefined;
    if (!thread) throw new Error("thought without a thread");
    /* One capture, one entry per Thread: parts sent to the same Thread are
       one thought that was split. */
    const key = (target: NonNullable<SimpleSortItem["thread"]>) =>
      "id" in target ? `id:${target.id}` : `new:${nameKey(target.name)}`;
    const same = out.find((prior) => prior.thread && key(prior.thread) === key(thread));
    if (same) same.text = `${same.text} ${item.text}`;
    else out.push({ kind, text: item.text, thread });
  }
  /* A capture that is one thought is kept word for word. The model's wording
     is only needed where it had to divide the capture into parts. */
  if (out.length === 1 && out[0].kind === "thought" && context.raw?.trim()) {
    out[0].text = context.raw.trim();
  }
  return out;
}

/** One model call. Cerebras gets JSON-object mode (it rejects schemas); the
 * Zod schema stays the boundary either way. */
export async function generateSimpleSort({ tier, prompt, abortSignal }: {
  tier: Tier;
  prompt: string;
  abortSignal?: AbortSignal;
}): Promise<unknown> {
  const common = {
    model: tier.model,
    maxRetries: 0 as const,
    maxOutputTokens: 4_000,
    abortSignal,
    temperature: 0,
    prompt,
    providerOptions: tier.providerOptions,
  };
  if (tier.name === "cerebras") {
    const { object } = await generateObject({ ...common, output: "no-schema" });
    return object;
  }
  const { object } = await generateObject({ ...common, schema: SimpleSortSchema });
  return object;
}
