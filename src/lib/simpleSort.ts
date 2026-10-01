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
    threadIds: z.array(z.string()),
    newThread: z.string().nullable(),
    due: z.string().nullable(),
    sameAsAction: z.string().nullable(),
  })).min(1).max(12),
});

/** What is accepted back: a model may leave out a null field, or name one
 * thread as threadId. */
const Answer = z.object({
  items: z.array(z.object({
    kind: z.enum(["action", "thought", "intention"]),
    text: z.string().trim().min(1).max(20_000),
    threadIds: z.array(z.string().max(100)).max(4).nullish(),
    threadId: z.string().max(100).nullish(),
    newThread: z.string().trim().max(100).nullish(),
    due: z.string().max(40).nullish(),
    sameAsAction: z.string().max(100).nullish(),
  })).min(1).max(12),
});

export type SimpleSortTarget = { id: string } | { name: string };
export type SimpleSortItem = {
  kind: "action" | "thought" | "intention";
  text: string;
  /** Thoughts only: every Thread it belongs to (existing ids, or new names). */
  threads?: SimpleSortTarget[];
  /** Actions only: ISO date as the model resolved it. */
  due?: string;
  /** Actions only: the open Action this one repeats, instead of a new one. */
  existingActionId?: string;
};

/** Today and the next seven days in the person's own timezone, day name
 * first, so no weekday is ever computed. tzOffset is Date#getTimezoneOffset(). */
export function calendar(now: number, tzOffset = 0): string {
  const day = (offset: number) => {
    const date = new Date(now - tzOffset * 60_000 + offset * 86_400_000);
    const name = date.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
    return `${name} ${date.toISOString().slice(0, 10)}${offset === 0 ? " (today)" : offset === 1 ? " (tomorrow)" : ""}`;
  };
  const today = new Date(now - tzOffset * 60_000);
  const monthEnd = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0));
  const endName = monthEnd.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  return [...Array.from({ length: 8 }, (_, offset) => day(offset)), `End of this month: ${endName} ${monthEnd.toISOString().slice(0, 10)}`].join("\n");
}

type ThreadBrief = { id: string; name: string; about: string };
type OpenAction = { id: string; text: string };
type Correction = { capture: string; kind: string; threadId?: string; threadName?: string };
type Force = "action" | "thread" | "intention";

export function simpleSortPrompt(input: {
  raw: string;
  threads: ThreadBrief[];
  actions?: OpenAction[];
  corrections?: Correction[];
  force?: Force;
  now?: number;
  tzOffset?: number;
}): string {
  const corrections = (input.corrections ?? []).map((example) =>
    `- "${example.capture}" → ${example.kind === "thread" ? `thought in ${example.threadName ?? example.threadId}` : example.kind}`
  ).join("\n");
  const actions = (input.actions ?? []).slice(0, 80);
  return [
    "You sort one capture from someone's personal notes app. Say what is in it.",
    'Return one JSON object: {"items":[{"kind":"thought"|"action"|"intention","text":string,"threadIds":string[],"newThread":string|null,"due":string|null,"sameAsAction":string|null}]}',
    "",
    "KINDS",
    "- thought: an idea, observation, question, opinion, plan being thought through, bug report, complaint, reference or lesson. Every thought goes to a Thread.",
    "- action: a specific task the person gives themselves: an instruction to themselves (\"Add retry logging\", \"Verify the pictures survive sorting\") or \"I need to / I have to / I'll\" plus a task (\"I need to email Mia\"). Each task is its own action, even when several share one sentence: \"reproduce the error and compare the prices\" is two actions. A task put off to a time (\"the guide can wait until the end of the month\") is still an action, due then. NOT actions, but part of the thought: what they would like to do or are considering (\"on a rest day I want to walk and play a game\"), how a product should behave (\"retry fast, then leave it unsorted\"), what something still needs (\"the tower still needs to match the rain\"), and a general resolve (\"I will build\").",
    "- intention: the person declaring, in their own voice, a way of being or a reality of their life or work as already true: \"I rest without guilt\", \"I have built a strong audience that supports my work\", \"I rebuild Capture carefully, one verified slice at a time\". Present-tense \"I am / I have / I do\" statements about themselves are intentions, even when they name a project. A plan, wish, question or \"should\" about a project is a thought. Only when the whole capture is the declaration, or when they explicitly call a part an intention (\"my intention\", \"an intention for how I live\"). A part they call an intention is its own intention item, without the label: \"Fix the login. An intention for how I live: I say no easily.\" → an action \"Fix the login\" and an intention \"I say no easily.\" Never pull an unlabeled intention out of a longer thought.",
    "",
    "SPLITTING",
    "Keep the capture as ONE item unless it clearly holds separate things: a different subject, or a task beside thoughts. Sentences about the same subject are one item, never one item per sentence. A long rant, complaint or bug report about one subject is ONE thought, even when it says what needs fixing (\"these bugs need to be fixed\", \"you need to add a button\"): the report is the note, not a list of tasks.",
    "",
    "TEXT",
    "Use the person's own words for that item: fix obvious dictation slips and drop filler, but never summarize and keep every idea. For an action, a short imperative (\"Check the heater\"), without the date.",
    "When the whole capture is one thought and nothing else, write its text as \"=\": the person's words are kept exactly as they are, so never copy a capture out whole.",
    "",
    "THREADS",
    "For a thought, threadIds lists every existing Thread it belongs in, judged by each Thread's description. One thought about several projects belongs to each of them (\"Retake could record the TechTutor walkthroughs while Capture holds the lesson ideas\" → TechTutor, Retake and Capture). Only if none fits, leave threadIds empty and set newThread to a short name.",
    "\"Add this to X\", \"put this in X\", \"create a new thread called X\" are filing instructions, not items: put the rest of the capture in X (its existing id, or newThread exactly X).",
    "",
    "DUE",
    "For an action with a stated day or date, due is the ISO date (YYYY-MM-DD); otherwise null. A deadline covers every task it names (\"By Friday I need to A, B and C\" → each due Friday). A different date given later for one task (\"do C next Monday instead\") applies to that task only. A weekday (\"Tuesday\", \"next Tuesday\", \"by Friday\") is the date this calendar lists for that weekday. Look days up in this calendar; never calculate them:",
    calendar(input.now ?? Date.now(), input.tzOffset),
    ...(actions.length ? ["", `Open actions (an action that is the same task as one of these sets sameAsAction to its id; otherwise null):\n${JSON.stringify(actions.map(({ id, text }) => ({ id, text })))}`] : []),
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
  context: { threads: { id: string; name: string }[]; actions?: OpenAction[]; force?: Force; raw?: string },
): SimpleSortItem[] {
  const { items } = Answer.parse(untrusted);
  const byId = new Map(context.threads.map((thread) => [thread.id, thread]));
  const byName = new Map(context.threads.map((thread) => [nameKey(thread.name), thread]));
  const openActions = new Set((context.actions ?? []).map((action) => action.id));
  /* "=" stands for the whole capture, so a long one is never typed out
     again (that ran past the output limit). It is only a whole capture
     when it is the only item. */
  if (items.some((item) => item.text === "=") && (items.length !== 1 || !context.raw?.trim())) {
    throw new Error("'=' used for part of a capture");
  }
  const out: SimpleSortItem[] = [];
  for (const item of items) {
    const kind = context.force === "thread" ? "thought" : context.force ?? item.kind;
    if (kind === "action") {
      const due = item.due && ISO_DAY.test(item.due) ? item.due : undefined;
      const existing = item.sameAsAction && openActions.has(item.sameAsAction) ? item.sameAsAction : undefined;
      out.push({ kind, text: item.text, ...(due ? { due } : {}), ...(existing ? { existingActionId: existing } : {}) });
      continue;
    }
    if (kind === "intention") {
      out.push({ kind, text: item.text });
      continue;
    }
    const ids = [...(item.threadIds ?? []), ...(item.threadId ? [item.threadId] : [])].filter((id) => byId.has(id));
    const named = item.newThread ? byName.get(nameKey(item.newThread)) : undefined;
    if (named) ids.push(named.id);
    const threads: SimpleSortTarget[] = [...new Set(ids)].map((id) => ({ id }));
    if (!threads.length && item.newThread) threads.push({ name: item.newThread });
    if (!threads.length) throw new Error("thought without a thread");
    out.push({ kind, text: item.text, threads });
  }
  /* A capture that is one thought is kept word for word. The model's wording
     is only needed where it had to divide the capture into parts. */
  if (out.length === 1 && out[0].kind === "thought" && context.raw?.trim()) {
    out[0].text = context.raw.trim();
  }
  if (out[0]?.text === "=") {
    if (out[0].kind !== "intention") throw new Error("'=' for an action");
    out[0].text = context.raw!.trim();
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
    maxOutputTokens: 8_000,
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
