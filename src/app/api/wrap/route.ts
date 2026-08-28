import { generateObject } from "ai";
import { z } from "zod";
import { clientIp } from "@/lib/clientIp";
import { modelRateLimit } from "@/lib/limiter";
import { withFallback } from "@/lib/providers";

/**
 * The daily wrap, in words.
 *
 * The counting is done on the client (wrap.ts) — this route only puts
 * language to numbers that are already settled. It cannot invent a figure:
 * every count it is allowed to mention is handed to it.
 *
 * The whole risk here is blandness. A wrap that says "a productive day with
 * several captures" is worse than no wrap, because it costs a read and
 * returns nothing. So the prompt spends most of its length on what NOT to
 * write, and the schema keeps the fields short enough that padding does not
 * fit.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({
  day: z.string(),
  stats: z.object({
    said: z.number(),
    threadsMoved: z.number(),
    actionsMade: z.number(),
    intentions: z.number(),
    threads: z.array(z.object({ name: z.string(), n: z.number() })),
    span: z.string(),
    returns: z.array(z.string()),
    finished: z.array(z.string()),
  }),
  /** What was said that day, in order — the raw material for the one line. */
  captures: z.array(z.object({ at: z.string(), text: z.string(), where: z.string() })),
  /** One line per recent day, oldest first, for the cross-day reading. */
  history: z.array(z.object({ day: z.string(), line: z.string() })),
});

/* Every field required and non-nullable: Groq's strict json_schema rejects
   the whole request when `required` omits a property, and the failure is
   silent — the call simply falls through to a weaker provider. */
const Result = z.object({
  line: z.string().describe("the day in one short sentence, at most 65 characters — it is shown on one or two lines above the board, so length is a hard constraint, not a preference"),
  insights: z
    .array(
      z.object({
        k: z.string().describe("one word, lowercase"),
        v: z.string().describe("one line, under 80 characters"),
      })
    )
    .min(1)
    .max(4),
  tomorrow: z.string().describe("one thing worth doing tomorrow, under 70 characters"),
});

const WRAP = `You are capture's daily wrap — a personal capture app. Below is one person's day: what they said, when, and where it landed. Write the short reading of that day.

You are writing for the person who lived the day. They already know what they did. What they cannot see is the SHAPE of it — what it added up to, what kept pulling at them, what they left open.

THE LINE — one sentence, at most 65 characters. Count them. This is the only part of the wrap most days will be read at all: it sits above the board with nothing around it, so it has to be short enough to take in at a glance and good enough to make the person open the rest.
- Name what kind of day it was, not what happened in it, and let it have a bit of edge. These examples are from a cafe owner's week so that you cannot lift them — match the shape, never the words: "A restocking day. You fixed the things you serve with." "One supplier ate the whole morning and asked for seconds." "Nothing new got made. Plenty got un-broken."
- Those lines are burned. Using one, or reskinning it with today's nouns, is a failed wrap: this person reads one every morning and would spot the repeat at once.
- Never a count. Never a list. Never "productive", "busy", "varied", "a mix of".
- Never praise and never scold. State the day plainly; the person can judge it.

THE INSIGHTS — two to four, each a one-word label and one line under 80 characters.
- Each one must be USEFUL: it should tell the person something they can act on, decide with, or would not have noticed themselves. That is the whole job. Personality is how you say it, never what you say instead.
- Before you write a line, ask: "does this change anything for them tomorrow?" If the answer is no, cut it and write a different one.
- The span, the totals and the thread ranking are ALREADY on screen above your lines — restating one is the single most common failure. Never spend an insight on how long the day was or how many captures there were.
- Rank what is worth saying, most useful first: (1) something recurring that they have not acted on, (2) what they finished against what they started, (3) a subject quietly taking over their week, (4) something they wrote once and abandoned, (5) a change of direction between morning and night. "8 of 24 were bugs. Today was repair, not build." earns its place; "24 captures today" does not — the number is already on screen above you.
- Use the real figures given below and no others. Never invent a number, a time, or a thread name.
- Prefer: what dominated, what recurred, what was left open, how long the day ran, what broke a pattern.
- If a history of past days is given, ONE insight may read across days — "third day running on bugs", "you closed the intention you opened Monday". This is the most valuable line you can write. Only write it if the history actually shows it.
- Labels are single lowercase words: pattern, weight, shift, streak, focus, late.

THE VOICE. This is the part most models get wrong, so read it twice.
- Dry, deadpan, genuinely funny. You are a friend who watched the whole day over your shoulder and has one very good observation about it. You are not an analyst filing a report, and "Bugs dominated the day's captures" is a report.
- The humour comes from noticing something true and saying it flatly. No jokes bolted onto facts — the fact IS the joke, if you find the right one.
- Here is the register. These are from somebody else's week — a person who runs a cafe — so that you cannot lift them. Match the RHYTHM, never the words:
  weight :: "Nine of your twelve notes were about the coffee machine. It has become a colleague."
  pattern :: "Third time this week you have written down the same supplier problem. It is not going to phone itself."
  late :: "Everything useful happened after closing. The mornings appear to be decorative."
  streak :: "Fourth day on the rota. At this point it is less a schedule and more a hostage situation."
  focus :: "One supplier took nine notes. The other four got a polite nod on the way past."
  open :: "You wrote down three things to order and ordered none of them, which is at least consistent."
  quiet :: "Four notes, all small. A slow day, and nobody seems to mind."
- Those are the REGISTER, not a menu. They are about coffee and suppliers precisely so that you cannot borrow them: the day below is a different life. Reusing one of those sentences, or reskinning it with the day's own nouns, is a failed wrap — this person reads one of these every morning and would spot the repeat immediately. Write new ones about the day in front of you.
- Notice what those have in common: each one states a real number or a real fact, then lands one short beat on the end. That beat is the whole job.
- The joke is about the WORK, never the person. Tease the day, the threads, the bugs, the app. Never call them scattered, lazy, obsessive or undisciplined.
- Warm, not snide. You are on their side. If a line reads as a dig at them rather than at the day, rewrite it.
- Hard limits: no exclamation marks, no emoji, no rhetorical questions, no puns on thread names, no motivational-poster language, no metaphors about journeys, momentum, grinding or crushing it.
- Never end on a lecture. "Time to break the cycle" and "worth addressing" are advice, and advice goes in TOMORROW, not here.

TOMORROW — one line, under 70 characters.
- One concrete thing, drawn from what the day was actually about — a subject that kept recurring, a thread that took everything, a name that came up once and never again.
- It must be doable in Capture or in the work itself. Never "close", "finish", or "resolve" an intention: that is not a thing this app does.
- Not advice about habits, focus, rest, or balance. Not encouragement. Something they could actually do.

Short sentences. Every line must be true first and funny second; a line that is funny and wrong is the worst thing you can write. If a line is not worth reading, cut it — two good insights beat four padded ones.

THE DAY:
`;

/* Server-side caps: a hostile or buggy client must not burn quota on one
   giant prompt. */
const CAP_CAPTURES = 40;
const CAP_TEXT = 120;

function promptFor(b: z.infer<typeof Body>) {
  const s = b.stats;
  const past = b.history.length
    ? `\nRecent days, oldest first:\n` +
      b.history.map((h) => `- ${h.day}: ${h.line}`).join("\n") +
      `\n`
    : "";
  return (
    WRAP +
    `Date: ${b.day}\n` +
    `Said: ${s.said}. Threads moved: ${s.threadsMoved}. Actions made: ${s.actionsMade}. Intentions set: ${s.intentions}.\n` +
    `Span: ${s.span}.\n` +
    `Threads, busiest first: ${s.threads.map((t) => `${t.name} (${t.n})`).join(", ") || "none"}.\n` +
    (s.finished.length
      ? `Finished today: ${s.finished.map((f) => `"${f}"`).join("; ")}.\n`
      : `Finished today: nothing was ticked off.\n`) +
    (s.returns.length > 1
      ? `Came back to ${s.threads[0]?.name} at ${s.returns.join(", ")}.\n`
      : "") +
    past +
    `\nWhat was said:\n` +
    b.captures
      .slice(0, CAP_CAPTURES)
      .map(
        (c) =>
          `- ${c.at} [${c.where}] ${c.text.length > CAP_TEXT ? c.text.slice(0, CAP_TEXT) + "…" : c.text}`
      )
      .join("\n")
  );
}

/* Models reach for typographic hyphens and the occasional emoji however
   firmly the prompt says not to. Normalising here is deterministic, where
   asking is not. */
function tidy(t: string): string {
  return t
    .replace(/[\u2010\u2011]/g, "-")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function clean(v: z.infer<typeof Result>) {
  return {
    line: tidy(v.line),
    tomorrow: tidy(v.tomorrow),
    insights: v.insights.map((i) => ({ k: tidy(i.k).toLowerCase(), v: tidy(i.v) })),
  };
}

export async function POST(request: Request) {
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

  try {
    const { value, via } = await withFallback(async (tier) => {
      const { object } = await generateObject({
        model: tier.model,
        maxRetries: 0,
        schema: Result,
        system: "You are capture's daily wrap.",
        prompt: promptFor(body),
        providerOptions: tier.providerOptions,
      });
      return object;
    });
    return Response.json({ ...value, ...clean(value), via });
  } catch {
    /* No wrap is written when no model answers. The day is still in the
       ledger, so tomorrow's open can try again — nothing is lost. */
    return Response.json({ error: "offline" }, { status: 503 });
  }
}
