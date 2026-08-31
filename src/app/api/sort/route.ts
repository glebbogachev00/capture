import { generateObject, generateText } from "ai";
import { z } from "zod";
import { applyRules } from "@/lib/ruleMatch";
import { preferredFor } from "@/lib/routing";
import { explain } from "@/lib/aiError";
import { captionPrompt, mergeCaption, tidyCaption } from "@/lib/caption";
import { clientIp } from "@/lib/clientIp";
import { modelRateLimit } from "@/lib/limiter";
import { visionChain, withFallback } from "@/lib/providers";
import { DUE_RULE, ROUTING_RULE, todayLine } from "@/lib/engineRules";
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
      "the capture in the person's own words, tidied — an EDIT, never a rewrite. Fix punctuation, casing and obvious transcription garble; drop pure filler (um, uh, false starts). APPLY spoken self-corrections instead of transcribing them: when the speaker corrects themselves — 'not AI, just Retake', 'I mean Tuesday' — keep only the corrected reading. Collapse restarts: a clause said twice while the speaker found their footing appears once. 'For Retake AI, I need to check, not AI, just Retake. I need to check how it works right now' becomes 'For Retake, I need to check how it works right now.' The exact words are always preserved in the person's record, so removing dictation noise loses nothing — but the line between noise and content is sacred: never swap in synonyms, never summarise, never drop an idea, never change a number, a name or a claim, and when unsure whether something is a correction or a new thought, keep both. Break it into short paragraphs separated by a blank line, one per distinct idea. Use '- ' bullets on their own lines wherever they are listing things. Never return one unbroken block."
    ),
  kind: z.enum(["action", "thread", "intention", "both"]),
  title: z.string().describe("max 6 words"),
  actions: z
    .array(z.string())
    .describe(
      "imperative one-line items, each readable on its own a week later with none of the capture around it — the subject goes IN the line, never left behind as \"this\" or \"that\""
    ),
  shelfLife: z.enum(["hours", "days", "weeks", "keep"]),
  due: z
    .string()
    .nullable()
    .describe(
      "ISO date or date-time the capture explicitly names as its deadline (resolve relative words like 'friday' or 'tomorrow' against today's date given in the prompt), or null when no date is stated"
    ),
  threadId: z
    .string()
    .nullable()
    .describe("id of the best existing thread, or null"),
  threadName: z
    .string()
    .nullable()
    .describe("name for a new thread, or null"),
  /* One breath can be about two subjects. "Retake is slow on my machine and
     Capture keeps mis-sorting" is not one thought filed twice — it is two
     thoughts said together, and filing the whole sentence in one thread
     puts half of it where its owner will never look for it.

     The primary destination above still carries the capture. This names the
     OTHER places part of it belongs, each with only its own share of the
     words. Bounded at three, because a capture that claims to be about five
     subjects is almost always one subject the model failed to name. */
  /* `clean` stays the whole capture — the ledger records it, Undo restores
     it, the misfiled question quotes it. So the primary's share needs its
     own field rather than narrowing `clean`, which would fight every other
     use of it. Null when there is no split. */
  primaryText: z
    .string()
    .nullable()
    .describe(
      "when `also` is used, ONLY the part of the capture that stays with the primary destination — the words in `also` must not appear here. Null when `also` is empty"
    ),
  also: z
    .array(
      z.object({
        text: z
          .string()
          .describe(
            "only the part of the capture that belongs here, in the person's own words"
          ),
        threadId: z
          .string()
          .nullable()
          .describe("id of the existing thread this part belongs to, or null"),
        threadName: z
          .string()
          .nullable()
          .describe("name for a new thread for this part, or null"),
      })
    )
    .max(3)
    .nullable()
    .describe(
      /* Was "further threads this capture also belongs in", which asks the
         wrong question. "Does this whole capture belong in two places?" is
         almost always no, so the field stayed empty even where the capture
         plainly changed subject halfway through. The question that gets an
         honest answer is how many subjects are IN it. */
      "one entry per FURTHER SUBJECT present in this capture, carrying only the words that belong to that subject — not places the whole capture belongs. Empty when everything said is about one subject"
    ),
});

/** A compact record of a recent capture and where it landed. */
const Recent = z.object({
  raw: z.string(),
  kind: z.string(),
  target: z.string(),
  /** When it was captured. Minutes-ago is the signal that tells a series
      of pastes apart from a change of subject. */
  at: z.number().optional(),
});

/** "3 min ago", "2 h ago", "4 d ago" — or nothing, for old history. */
function ago(at: number | undefined, now: number): string {
  if (!at) return "";
  const m = Math.max(0, Math.round((now - at) / 60_000));
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

const Body = z.object({
  raw: z.string(),
  threads: z.array(
    z.object({ id: z.string(), name: z.string(), about: z.string() })
  ),
  /** How this person has filed their recent captures — pattern context. */
  recent: z.array(Recent).max(40).optional(),
  /** The set this capture plausibly continues, decided by the client from
      shape and timing (lib/series.ts). A named default, not an order. */
  series: z
    .object({ threadId: z.string(), threadName: z.string(), minutesAgo: z.number() })
    .optional(),
  /** Learned filing preferences (bounded, clearable, advisory). The client
      sends the rule sentences it derived from the correction ledger. */
  rules: z.array(z.string()).max(5).optional(),
  /** The destination is already decided; only the wording is in question. */
  force: z.enum(["action", "thread", "intention"]).optional(),
  /** One attached photo (data URL), captioned by a vision tier before the
      sort so an image capture files by what it actually shows. Bounded to
      the size a shrunk photo actually reaches — a hand-built multi-megabyte
      payload has no business in a sort request. */
  imgs: z.array(z.string().max(2_000_000)).max(1).optional(),
});

/**
 * Ask a vision-capable tier what a photo shows, in one sentence. Returns null
 * when no vision tier is configured or the call fails — the caption is a
 * bonus layer and the sort must never depend on it.
 */
async function captionImage(dataUrl: string): Promise<string | null> {
  if (!visionChain().length) return null;
  try {
    const { value } = await withFallback(async (tier) => {
      const out = await generateText({
        model: tier.model,
        maxRetries: 0,
        providerOptions: tier.providerOptions,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", image: dataUrl },
              { type: "text", text: captionPrompt() },
            ],
          },
        ],
      });
      return { text: out.text };
    });
    return tidyCaption(value.text);
  } catch {
    /* Vision is a bonus; a spent tier never blocks a capture. */
    return null;
  }
}

/** A short, plain digest of how this person recently filed things. Bounded
    on the client, but capped again here so a large payload can't bloat the
    prompt. Empty string when there is no history to show. */
function recentContext(recent: z.infer<typeof Recent>[] | undefined) {
  if (!recent?.length) return "";
  const now = Date.now();
  const lines = recent
    .slice(0, 20)
    .map((r) => {
      const said = r.raw.length > 90 ? r.raw.slice(0, 90) + "…" : r.raw;
      const where = r.target ? ` (${r.target})` : "";
      const when = ago(r.at, now);
      return `- "${said}" → ${r.kind}${where}${when ? `, ${when}` : ""}`;
    })
    .join("\n");
  /* The capture immediately before this one gets its own sentence when it
     is fresh: a series is decided by what just happened, and a line buried
     in a list of twenty is not what just happened. */
  const last = recent[0];
  const lastAge = last?.at ? now - last.at : Infinity;
  const previous =
    last && lastAge < 30 * 60_000 && last.target
      ? `\nThe capture immediately before this one, ${ago(last.at, now)}, was ` +
        `"${last.raw.length > 90 ? last.raw.slice(0, 90) + "…" : last.raw}" and it ` +
        `went to the thread "${last.target}". If this capture is the same kind ` +
        `of thing, it goes there too.\n`
      : "";
  return (
    previous +
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

/** The series, said plainly and last — the thing the model reads right
    before it decides, with the id it should use already in hand. */
function seriesContext(series: z.infer<typeof Body>["series"]) {
  if (!series) return "";
  return (
    `\nTHIS MAY BE THE NEXT ONE IN A SET. The capture ${series.minutesAgo} ` +
    `minute${series.minutesAgo === 1 ? "" : "s"} ago had the same shape as this ` +
    `one and went to the thread "${series.threadName}" (threadId "${series.threadId}").\n` +
    `This says NOTHING about the kind. Decide the kind on its own merits ` +
    `first: a task pasted after a draft is still an action, and a state they ` +
    `are declaring about themselves is still an intention. Only if the kind ` +
    `turns out to be "thread" or "both" does the set matter — and then set ` +
    `threadId to "${series.threadId}", even if the two are about different ` +
    `subjects and even though that thread is named after the app, because a ` +
    `set belongs together.\n`
  );
}


function prompt(
  raw: string,
  threads: z.infer<typeof Body>["threads"],
  force?: "action" | "thread" | "intention",
  recent?: z.infer<typeof Recent>[],
  rules?: z.infer<typeof Body>["rules"]
,
  series?: z.infer<typeof Body>["series"]) {
  if (force === "action") {
    return (
      todayLine() +
      "This is an excerpt from someone's running notes, and they have already decided there is something to DO in it. Your only job is to say what.\n\n" +
      'Excerpt:\n"""' +
      raw +
      '"""\n\n' +
      'Set kind to "action". Leave the thread fields null.\n' +
      "Fill actions with 1-3 imperative one-line items — the thing to actually do, not a description of the thinking around it. If only one thing is genuinely doable, return one.\n" +
      "Each one must stand alone: it will be read as a single line with none of the surrounding words, so put the subject INTO it. \"Have engineering handle the verification workflow\", never \"Have engineering handle this\".\n" +
      "Set clean to the excerpt tidied up, and title to at most six words.\n\n" +
      "shelfLife is how long this stays worth looking at. Judge it honestly:\n" +
      '- "hours" for something tied to today.\n' +
      '- "days" for ordinary errands and small follow-ups.\n' +
      '- "weeks" for real work that takes a while.\n' +
      '- "keep" for commitments to other people, money, deadlines, or anything with consequences if it silently vanished. When unsure, choose "keep".' +
      DUE_RULE
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
      "\n" +
      ROUTING_RULE +
      seriesContext(series) +
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
    todayLine() +
    "You are the sorting engine inside a personal capture app. Input arrives either dictated by voice — garbled, repetitive, half-finished — or pasted in as a raw unformatted block. Do the thinking so they don't have to.\n\n" +
    "Shaping the text matters as much as sorting it. This is DICTATED speech: apply spoken self-corrections instead of transcribing them ('For Retake AI, I need to check, not AI, just Retake. I need to check how it works right now' means the person corrected themselves and restarted — file 'For Retake, I need to check how it works right now'). Collapse restarts; drop the mumble, keep every idea. The exact words always survive in their record, so removing dictation noise loses nothing — but never summarise, never drop an idea, never alter a number, name or claim. A long capture that comes back as one dense paragraph is useless to reread, so:\n" +
    "- Put a blank line between distinct ideas. A capture covering five things should come back as roughly five short paragraphs.\n" +
    "- When they list or enumerate, use '- ' bullets on their own lines.\n" +
    "- If the pasted text already has structure, keep it rather than flattening it.\n" +
    "- Do not add headings, numbering, or any commentary of your own.\n\n" +
    "Their existing threads:\n" +
    (threads.length ? JSON.stringify(threads) : "(none yet)") +
    "\n" +
    ROUTING_RULE +
    recentContext(recent) +
    rulesContext(rules) +
    seriesContext(series) +
    '\nRaw capture:\n"""' +
    (raw || "(image only)") +
    '"""\n\n' +
    'There are four kinds. The reference examples below are your guide for telling them apart.\n' +
    'kind = "action" when this is a task, errand, reminder, or decision that gets closed out — there is a concrete thing to do. Fill "actions" with the one to three items actually being asked for, and leave the thread fields null. Never pad the list: if only one thing is genuinely doable, return one.\n' +
    'kind = "thread" when this is thinking, worldbuilding, an idea being developed, or material that accumulates — a subject to keep adding to, with no single thing to do. Set threadId if one clearly fits, otherwise invent a short threadName. Leave "actions" empty.\n' +
    'kind = "intention" only when they are declaring something they are calling into being about themselves or their life — a state they want to be living in, spoken as a wish, a resolve, or an aspiration. "I want to wake at 6 and actually feel rested", "I live somewhere with light", "I stop taking on work I resent". These are about how they want to be, not tasks to close or subjects to think about. Leave "actions" and the thread fields null.\n' +
    'An intention is the ESSENCE of a state — a sentence or two. A detailed PLAN is not one, however much it is spoken in "I will": the moment the words carry schedules, counts, quantities, exercise lists, or step-by-step structure ("I will run twice a week for 30 to 40 minutes, do push-ups, dips and pull-ups, walk 10,000 steps, keep to 500-600 calories, and organize my schedule around it"), the person is DESIGNING a routine, not declaring a state — that is thinking that accumulates, so it is a thread. Filing a plan as an intention throws the plan away: the intention keeps only a condensed sentence, and paragraphs of specifics the person dictated are lost. When a capture holds both a true declaration AND its detailed plan, the plan is the primary thing — file it as the thread, and let the person declare the one-line intention separately if they want it. Length is the cheapest tell: multiple paragraphs are almost never an intention.\n' +
    'kind = "both" when the capture carries a line of thinking the person is still turning over AND a concrete task to close — typically a deadline or a commitment to someone. Filing it as only an action throws the thinking away; filing it as only a thread buries the task. So do both: fill "actions" with the task(s), set threadId (route to an existing thread when one fits) or threadName for the thinking, and "clean" holds the thinking for the thread fragment. The tell is a capture where one part is a decision/idea/deliberation and another part is a dated or promised thing to do. Do not use "both" for pure thinking with no committed task (that is a thread), or for a plain task with no real deliberation around it (that is an action).\nA capture can hold MORE than two kinds — a task, a question being turned over, and a rule the person is setting for themselves, all in one breath. There is no shape for three, and the failure to avoid is quietly picking one and dropping the rest: a capture that plainly contains something to do must never come back as a bare thread with an empty actions list. When a capture holds a task and anything else at all, use "both", put every task in "actions", and let "clean" carry the whole of the rest — the thinking and any standing rule — so nothing the person said loses its place.\n' +
    'Every action must stand on its own. A week from now it will be read as a single line on a list, with none of the words around it — so it has to carry its own subject. Take the context from the capture and put it IN the action: not "Have engineering handle this" but "Have engineering handle the verification workflow"; not "Create workflows" but "Create workflows so agents ship without me reviewing"; not "Fix this bug" but "Fix the mis-sorting into the wrong threads". If you cannot tell what an action refers to when you read it alone, it is not finished.\n' +
    'This is the most common way the list goes wrong: a sentence gets chopped at its clauses and each fragment becomes an item. "Stop over building. Create workflows and have engineering handle this. Do all the verification and checks." is ONE thought about how to work — at most one action, carrying the whole of what it asks. Three stubs from three clauses is a worse answer than one complete line.\n' +
    'Do NOT choose "intention" for an ordinary errand phrased as a want ("I want to get milk" is an action), or for thinking about a topic ("been reading about sleep cycles" is a thread).\n' +
    'Before you answer "thread", run one check: did they commit to something? A person named, a day or date, a thing owed or promised — "I told Marc I would demo it on Friday", "I said I would send Jen the outline by Monday". The sentence around it can be pure deliberation and the commitment still stands: it does not stop being a promise because they were thinking out loud when they made it. If the capture holds one, the answer is "both", never "thread" — filing it as a thread loses the promise, which is the one part with a deadline on it. A date that belongs to the SUBJECT rather than to them ("the deadline for the grant is in March", "their launch is next week") is not a commitment and does not make it "both".\n' +
    'The check runs on what they SAID, never on what you would advise. An observation is not a decision: "the 4am waking seems worse after late screens" notices a pattern, it does not commit anyone to cutting screens, and turning it into "Try cutting screens before bed" invents a task they never set. Noticing what might help is thinking. If the only action you can produce is one you thought of, there is no action and the answer is "thread".\n' +
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
    '- "keep" for commitments to other people, money, deadlines, or anything with consequences if it silently vanished. When unsure, choose "keep".' +
    DUE_RULE
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

  /* A capture that carries a photo is sorted by what it shows, not as an
     opaque "(image only)". The caption merges into the raw text; when no
     vision tier is available it stays as it was sent. */
  let raw = body.raw;
  if (body.imgs?.[0]) {
    const caption = await captionImage(body.imgs[0]);
    if (caption) raw = mergeCaption(body.raw, caption);
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
        prompt: prompt(raw, body.threads, body.force, body.recent, body.rules, body.series),
        providerOptions: tier.providerOptions,
      });
      return object;
    }, preferredFor("sort"));
    /* The user's command outranks the model: when a destination was forced,
       the answer must obey it even if the model drifted. For a thread, the
       model still picks the best existing thread; only the kind and the
       actions are pinned. */
    let { kind, actions, threadId, threadName } = value;
    /* A learned rule is applied here, not left to the model's mood. The
       prompt offered the rules as tendencies and the fallback tier ignored
       them; a rule the board wrote has a known shape, so when the capture
       carries every word of its subject the rule sets the kind (and the
       home, if it names one), and only the remaining choices are the
       model's. A typed command still outranks a rule. */
    const ruled = body.force ? null : applyRules(raw, body.rules, body.threads);
    if (ruled && ruled.kind !== kind) {
      kind = ruled.kind;
      if (ruled.kind === "action") {
        threadId = null;
        threadName = null;
        if (!actions?.length) actions = [value.title || raw];
      } else if (ruled.kind === "intention") {
        threadId = null;
        threadName = null;
        actions = [];
      } else {
        actions = [];
      }
    }
    if (ruled?.threadId) {
      threadId = ruled.threadId;
      threadName = null;
    }
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
    /* A series is decided, not suggested. The client saw a capture of the
       same shape land on a thread minutes ago (lib/series.ts); told this in
       the prompt, the model still opened a fresh thread a third of the time,
       because the new draft's SUBJECT is vivid and a set is not a subject.
       So when the model wanted a new thread for something that is thread
       material, the set wins. The model keeps two vetoes: the kind (a task
       pasted after a post is still an action), and a DIFFERENT existing
       thread, which means it found a better home than the set. */
    if (
      body.series &&
      (kind === "thread" || kind === "both") &&
      !threadId &&
      body.threads.some((t) => t.id === body.series!.threadId)
    ) {
      threadId = body.series.threadId;
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
