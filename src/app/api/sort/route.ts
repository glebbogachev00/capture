import { generateObject } from "ai";
import { z } from "zod";
import { explain } from "@/lib/aiError";
import { clientIp } from "@/lib/clientIp";
import { modelRateLimit } from "@/lib/limiter";
import { withFallback } from "@/lib/providers";
import { reconcileSorted } from "@/lib/sort";

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
  kind: z.enum(["action", "thread", "intention", "both"]),
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

/** A compact record of a recent capture and where it landed. */
const Recent = z.object({
  raw: z.string(),
  kind: z.string(),
  target: z.string(),
});

const Body = z.object({
  raw: z.string(),
  threads: z.array(
    z.object({ id: z.string(), name: z.string(), about: z.string() })
  ),
  /** How this person has filed their recent captures — pattern context. */
  recent: z.array(Recent).max(40).optional(),
  /** Learned filing preferences (bounded, clearable, advisory). The client
      sends the rule sentences it derived from the correction ledger. */
  rules: z.array(z.string()).max(5).optional(),
  /** The destination is already decided; only the wording is in question. */
  force: z.enum(["action", "thread", "intention"]).optional(),
});

/** A short, plain digest of how this person recently filed things. Bounded
    on the client, but capped again here so a large payload can't bloat the
    prompt. Empty string when there is no history to show. */
function recentContext(recent: z.infer<typeof Recent>[] | undefined) {
  if (!recent?.length) return "";
  const lines = recent
    .slice(0, 20)
    .map((r) => {
      const said = r.raw.length > 90 ? r.raw.slice(0, 90) + "…" : r.raw;
      const where = r.target ? ` (${r.target})` : "";
      return `- "${said}" → ${r.kind}${where}`;
    })
    .join("\n");
  return (
    "\nHow this person has recently filed captures — match their patterns and " +
    "route into an existing thread when this clearly belongs with one:\n" +
    lines +
    "\n"
  );
}

/** Learned preferences, injected as tendencies — never orders. Empty when
    the model has learned nothing yet. */
function rulesContext(rules: z.infer<typeof Body>["rules"]) {
  if (!rules?.length) return "";
  const lines = rules.map((r) => "- " + r).join("\n");
  return (
    "\nFiling preferences this person has shown over time — treat these as " +
    "tendencies, not orders, and only follow one when the capture clearly " +
    "fits it:\n" +
    lines +
    "\n"
  );
}

function prompt(
  raw: string,
  threads: z.infer<typeof Body>["threads"],
  force?: "action" | "thread" | "intention",
  recent?: z.infer<typeof Recent>[],
  rules?: z.infer<typeof Body>["rules"]
) {
  if (force === "action") {
    return (
      "This is an excerpt from someone's running notes, and they have already decided there is something to DO in it. Your only job is to say what.\n\n" +
      'Excerpt:\n"""' +
      raw +
      '"""\n\n' +
      'Set kind to "action". Leave the thread fields null.\n' +
      "Fill actions with 1-3 imperative one-line items — the thing to actually do, not a description of the thinking around it. If only one thing is genuinely doable, return one.\n" +
      "Set clean to the excerpt tidied up, and title to at most six words.\n\n" +
      "shelfLife is how long this stays worth looking at. Judge it honestly:\n" +
      '- "hours" for something tied to today.\n' +
      '- "days" for ordinary errands and small follow-ups.\n' +
      '- "weeks" for real work that takes a while.\n' +
      '- "keep" for commitments to other people, money, deadlines, or anything with consequences if it silently vanished. When unsure, choose "keep".'
    );
  }
  if (force === "thread") {
    return (
      "This is an excerpt from someone's running notes, and they have already decided this is THINKING — a subject to keep adding to, not a task to close out. Your only job is to file it.\n\n" +
      'Excerpt:\n"""' +
      raw +
      '"""\n\n' +
      'Set kind to "thread". Leave "actions" empty.\n' +
      "Pick the best existing thread below if one clearly fits and set threadId to its id; otherwise set threadId to null and invent a short threadName.\n" +
      "Their existing threads:\n" +
      (threads.length ? JSON.stringify(threads) : "(none yet)") +
      "\nSet clean to the excerpt tidied up, and title to at most six words."
    );
  }
  if (force === "intention") {
    return (
      "This is an excerpt from someone's running notes, and they have already declared an intention — a state they are calling into being about themselves or their life, spoken as a wish, a resolve, or an aspiration. Not a task to close out, not a subject to think about.\n\n" +
      'Excerpt:\n"""' +
      raw +
      '"""\n\n' +
      'Set kind to "intention". Leave "actions" and both thread fields null.\n' +
      "Set clean to the intention rewritten so it reads as something they are already living into, keeping their voice and every idea, and title to at most six words."
    );
  }
  return (
    "You are the sorting engine inside a personal capture app. Input arrives either dictated by voice — garbled, repetitive, half-finished — or pasted in as a raw unformatted block. Do the thinking so they don't have to.\n\n" +
    "Shaping the text matters as much as sorting it. A long capture that comes back as one dense paragraph is useless to reread, so:\n" +
    "- Put a blank line between distinct ideas. A capture covering five things should come back as roughly five short paragraphs.\n" +
    "- When they list or enumerate, use '- ' bullets on their own lines.\n" +
    "- If the pasted text already has structure, keep it rather than flattening it.\n" +
    "- Do not add headings, numbering, or any commentary of your own.\n\n" +
    "Their existing threads:\n" +
    (threads.length ? JSON.stringify(threads) : "(none yet)") +
    "\n" +
    recentContext(recent) +
    rulesContext(rules) +
    '\nRaw capture:\n"""' +
    (raw || "(image only)") +
    '"""\n\n' +
    'There are four kinds. The reference examples below are your guide for telling them apart.\n' +
    'kind = "action" when this is a task, errand, reminder, or decision that gets closed out — there is a concrete thing to do. Fill "actions" with the one to three items actually being asked for, and leave the thread fields null. Never pad the list: if only one thing is genuinely doable, return one.\n' +
    'kind = "thread" when this is thinking, worldbuilding, an idea being developed, or material that accumulates — a subject to keep adding to, with no single thing to do. Set threadId if one clearly fits, otherwise invent a short threadName. Leave "actions" empty.\n' +
    'kind = "intention" only when they are declaring something they are calling into being about themselves or their life — a state they want to be living in, spoken as a wish, a resolve, or an aspiration. "I want to wake at 6 and actually feel rested", "I live somewhere with light", "I stop taking on work I resent". These are about how they want to be, not tasks to close or subjects to think about. Leave "actions" and the thread fields null.\n' +
    'kind = "both" when the capture carries a line of thinking the person is still turning over AND a concrete task to close — typically a deadline or a commitment to someone. Filing it as only an action throws the thinking away; filing it as only a thread buries the task. So do both: fill "actions" with the task(s), set threadId (route to an existing thread when one fits) or threadName for the thinking, and "clean" holds the thinking for the thread fragment. The tell is a capture where one part is a decision/idea/deliberation and another part is a dated or promised thing to do. Do not use "both" for pure thinking with no committed task (that is a thread), or for a plain task with no real deliberation around it (that is an action).\n' +
    'Do NOT choose "intention" for an ordinary errand phrased as a want ("I want to get milk" is an action), or for thinking about a topic ("been reading about sleep cycles" is a thread).\n' +
    'Be conservative, not eager. Only make an action when the capture actually asks for something to be done; never invent a task that is not there. When genuinely torn between thread and intention, choose "thread". When a capture is only thinking, choose "thread" — but when it clearly holds both a keepable line of thinking and a concrete task, "both" is right, so nothing is lost on either side.\n\n' +
    'Reference examples:\n' +
    '- "gotta call the dentist tomorrow and remember to buy milk on the way home" → kind "action", actions: ["Call the dentist tomorrow", "Buy milk on the way home"]\n' +
    '- "booked the flights, remember to sort out travel insurance" → kind "action", actions: ["Sort out travel insurance"]\n' +
    '- "was thinking about whether this project is worth continuing, weighing pros and cons" → kind "thread", threadName: "Is this project worth continuing"\n' +
    '- "been reading about sleep cycles and how they affect productivity" → kind "thread", threadName: "Sleep cycles and productivity"\n' +
    '- "still turning over whether to leave the agency, the dread every sunday is real — anyway I need to tell them my decision on the raise by friday" → kind "both", actions: ["Tell the agency my decision on the raise by Friday"], threadName: "Whether to leave the agency"\n' +
    '- "not sure the podcast idea is worth it, keep circling it, anyway I promised jen I\'d send her the draft outline by monday" → kind "both", actions: ["Send Jen the draft outline by Monday"], threadName: "Is the podcast idea worth it"\n' +
    '- "I want to wake up at 6 and actually feel rested" → kind "intention"\n' +
    '- "I live somewhere with light" → kind "intention"\n\n' +
    "shelfLife is how long this stays worth looking at, and it only applies to actions. Judge it honestly:\n" +
    '- "hours" for something tied to today: a call to return, a thing to grab on the way home.\n' +
    '- "days" for ordinary errands and small follow-ups.\n' +
    '- "weeks" for real work that takes a while: drafting, building, contacting someone properly.\n' +
    '- "keep" for commitments to other people, money, deadlines, or anything with consequences if it silently vanished. When unsure, choose "keep".'
  );
}

export async function POST(request: Request) {
  // Sorting spends real model quota; a single client can't run it in a loop.
  const gate = modelRateLimit(clientIp(request));
  if (!gate.allowed) {
    return Response.json(
      { error: `Too many requests. Try again in ${gate.retryAfterSec}s.` },
      { status: 429, headers: { "Retry-After": String(gate.retryAfterSec) } }
    );
  }

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
        // A spent free tier reports "retry in 26s"; fail fast so the chain
        // can fall through to the next provider instead of making the user
        // wait out the backoff.
        maxRetries: 0,
        schema: Sorted,
        prompt: prompt(body.raw, body.threads, body.force, body.recent, body.rules),
        providerOptions: tier.providerOptions,
      });
      return object;
    });
    /* The user's command outranks the model: when a destination was forced,
       the answer must obey it even if the model drifted. For a thread, the
       model still picks the best existing thread; only the kind and the
       actions are pinned. */
    let { kind, actions, threadId, threadName } = value;
    if (body.force === "thread") {
      kind = "thread";
      actions = [];
    } else if (body.force === "intention") {
      kind = "intention";
      actions = [];
      threadId = null;
      threadName = null;
    } else if (body.force === "action") {
      kind = "action";
      threadId = null;
      threadName = null;
    }
    // Collapse a self-contradicting "both" (no task, or no thinking) to the
    // single kind its fields actually support.
    const reconciled = reconcileSorted({
      ...value,
      kind,
      actions,
      threadId,
      threadName,
    });
    return Response.json({ ...value, ...reconciled, via });
  } catch (error) {
    console.error("sort failed", error);
    const { message, status } = explain(error);
    return Response.json({ error: message }, { status });
  }
}
