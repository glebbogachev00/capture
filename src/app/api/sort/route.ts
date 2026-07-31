import { generateObject } from "ai";
import { z } from "zod";
import { explain } from "@/lib/aiError";
import { withFallback } from "@/lib/providers";

/**
 * The sorting engine.
 *
 * The prompt lives here rather than in the browser so it can't be rewritten by
 * whatever is on the client, and so the API key stays on the server instead of
 * being shipped to every visitor.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

const Sorted = z.object({
  clean: z
    .string()
    .describe(
      "the capture rewritten so it is easy to read weeks later. Repair transcription garble, drop filler and false starts, keep their voice and every idea, and never add ideas that aren't there. Break it into short paragraphs separated by a blank line, one per distinct idea. Use '- ' bullets on their own lines wherever they are listing things. Never return one unbroken block."
    ),
  kind: z.enum(["action", "thread", "intention"]),
  title: z.string().describe("max 6 words"),
  actions: z.array(z.string()).describe("imperative one-line items"),
  shelfLife: z.enum(["hours", "days", "weeks", "keep"]),
  threadId: z
    .string()
    .nullable()
    .describe("id of the best existing thread, or null"),
  threadName: z
    .string()
    .nullable()
    .describe("name for a new thread, or null"),
});

const Body = z.object({
  raw: z.string(),
  threads: z.array(
    z.object({ id: z.string(), name: z.string(), about: z.string() })
  ),
});

function prompt(raw: string, threads: z.infer<typeof Body>["threads"]) {
  return (
    "You are the sorting engine inside a personal capture app. Input arrives either dictated by voice — garbled, repetitive, half-finished — or pasted in as a raw unformatted block. Do the thinking so they don't have to.\n\n" +
    "Shaping the text matters as much as sorting it. A long capture that comes back as one dense paragraph is useless to reread, so:\n" +
    "- Put a blank line between distinct ideas. A capture covering five things should come back as roughly five short paragraphs.\n" +
    "- When they list or enumerate, use '- ' bullets on their own lines.\n" +
    "- If the pasted text already has structure, keep it rather than flattening it.\n" +
    "- Do not add headings, numbering, or any commentary of your own.\n\n" +
    "Their existing threads:\n" +
    (threads.length ? JSON.stringify(threads) : "(none yet)") +
    '\n\nRaw capture:\n"""' +
    (raw || "(image only)") +
    '"""\n\n' +
    'kind = "action" when this is a task, errand, reminder, or decision that gets closed out. Fill "actions" with 1-4 items and leave the thread fields null.\n' +
    'kind = "thread" when this is thinking, worldbuilding, an idea being developed, or material that accumulates. Set threadId if one clearly fits, otherwise invent a short threadName. Leave "actions" empty.\n' +
    'kind = "intention" only when they are declaring something they are calling into being about themselves or their life — a state they want to be living in, spoken as a wish, a resolve, or an aspiration. "I want to wake at 6 and actually feel rested", "I live somewhere with light", "I stop taking on work I resent". These are about how they want to be, not tasks to close or subjects to think about. Leave "actions" and the thread fields null.\n' +
    'Do NOT choose "intention" for an ordinary errand phrased as a want ("I want to get milk" is an action), or for thinking about a topic ("been reading about sleep cycles" is a thread).\n' +
    'When genuinely torn between thread and intention, choose "thread". When genuinely torn between action and thread, choose "thread" — nothing gets lost there.\n\n' +
    "shelfLife is how long this stays worth looking at, and it only applies to actions. Judge it honestly:\n" +
    '- "hours" for something tied to today: a call to return, a thing to grab on the way home.\n' +
    '- "days" for ordinary errands and small follow-ups.\n' +
    '- "weeks" for real work that takes a while: drafting, building, contacting someone properly.\n' +
    '- "keep" for commitments to other people, money, deadlines, or anything with consequences if it silently vanished. When unsure, choose "keep".'
  );
}

export async function POST(request: Request) {
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch {
    return Response.json({ error: "bad request" }, { status: 400 });
  }

  if (!body.raw.trim()) {
    return Response.json({ error: "nothing to sort" }, { status: 400 });
  }

  try {
    const { value, via } = await withFallback(async (tier) => {
      const { object } = await generateObject({
        model: tier.model,
        schema: Sorted,
        prompt: prompt(body.raw, body.threads),
        providerOptions: tier.providerOptions,
      });
      return object;
    });
    return Response.json({ ...value, via });
  } catch (error) {
    console.error("sort failed", error);
    const { message, status } = explain(error);
    return Response.json({ error: message }, { status });
  }
}
