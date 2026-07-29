import { generateObject } from "ai";
import { z } from "zod";
import { explain } from "@/lib/aiError";
import { MODEL } from "@/lib/model-provider";

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
      "the capture rewritten as clear readable prose. Repair transcription garble, drop filler and false starts, keep their voice and every idea. Never add ideas that aren't there."
    ),
  kind: z.enum(["action", "thread"]),
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
    "You are the sorting engine inside a personal capture app. The person dictates by voice, so the input is often garbled, repetitive, or half-finished. Do the thinking so they don't have to.\n\n" +
    "Their existing threads:\n" +
    (threads.length ? JSON.stringify(threads) : "(none yet)") +
    '\n\nRaw capture:\n"""' +
    (raw || "(image only)") +
    '"""\n\n' +
    'kind = "action" when this is a task, errand, reminder, or decision that gets closed out. Fill "actions" with 1-4 items and leave the thread fields null.\n' +
    'kind = "thread" when this is thinking, worldbuilding, an idea being developed, or material that accumulates. Set threadId if one clearly fits, otherwise invent a short threadName. Leave "actions" empty.\n' +
    'When genuinely torn, choose "thread" — nothing gets lost there.\n\n' +
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
    const { object } = await generateObject({
      model: MODEL,
      schema: Sorted,
      prompt: prompt(body.raw, body.threads),
    });
    return Response.json(object);
  } catch (error) {
    console.error("sort failed", error);
    const { message, status } = explain(error);
    return Response.json({ error: message }, { status });
  }
}
