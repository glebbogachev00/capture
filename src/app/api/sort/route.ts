import { generateObject, generateText } from "ai";
import { z } from "zod";
import { preferredFor } from "@/lib/routing";
import { explain } from "@/lib/aiError";
import { captionPrompt, mergeCaptions, tidyCaption } from "@/lib/caption";
import { clientIp } from "@/lib/clientIp";
import { modelRateLimit } from "@/lib/limiter";
import { authorizeManagedAiRequest, withManagedAiAdmission } from "@/lib/cloudRequestGuard.server";
import {
  sanitizeProviderError,
  visionChain,
  withFallback,
} from "@/lib/providers";
import {
  opsEvent,
  routingStageEvent,
  routingValidationEvent,
  type RoutingProviderTier,
  type RoutingStageCode,
} from "@/lib/opsEvent.server";
import { DUE_RULE, RELATIVE_DUE_RULE, ROUTING_RULE, todayLine } from "@/lib/engineRules";
import { enforceStandingDecision, reconcileSorted } from "@/lib/sort";
import { scheduleJevThreadRerankShadow } from "@/lib/jevThreadRerank";
import {
  PlannedRoutingPlanSchema,
  RoutingPlanCandidateValidationError,
  compileRoutingPlan,
  planRoutingWithRetry,
  type PlannedSortResult,
  type RoutingPlanFailure,
} from "@/lib/plannedRouting";
import { generatePlannedRoutingCandidate } from "@/lib/plannedRoutingGeneration";
import {
  DeadlineAdjudicationError,
  adjudicatePlannedDeadlines,
  generatePlannedDeadlineAdjudicationCandidate,
  requiresPlannedDeadlineAdjudication,
} from "@/lib/plannedDeadlineAdjudication";
import {
  DestinationOwnershipAdjudicationError,
  adjudicatePlannedDestinationOwnership,
  generatePlannedDestinationOwnershipCandidate,
  requiresPlannedDestinationOwnership,
} from "@/lib/plannedDestinationOwnership";
import {
  ActionIdentityAdjudicationError,
  adjudicatePlannedActionIdentity,
  generatePlannedActionIdentityCandidate,
  requiresPlannedActionIdentity,
} from "@/lib/plannedActionIdentity";
import { SEMANTIC_KIND_BOUNDARY } from "@/lib/semanticKindBoundary";
import { shouldFormat } from "@/lib/captureFormat";
import { formatCapture } from "@/lib/captureFormat.server";
import { tightenActions } from "@/lib/actionText.server";
import { SIMPLE_SORT_VERSION, generateSimpleSort, normalizeSimpleSort, simpleSortPrompt } from "@/lib/simpleSort";
import { parseSortImageDataUrl } from "@/lib/sortImageDataUrl";

/**
 * The sorting engine.
 *
 * The prompt lives here rather than in the browser so it can't be rewritten by
 * whatever is on the client, and so the API key stays on the server instead of
 * being shipped to every visitor.
 */

export const runtime = "nodejs";
export const maxDuration = 60;
const PLANNING_DEADLINE_MS = 55_000;

function routingStageCode(error: unknown, signal: AbortSignal): RoutingStageCode {
  if (signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
    return "ABORTED";
  }
  if (error instanceof DeadlineAdjudicationError) return error.code;
  if (error instanceof DestinationOwnershipAdjudicationError) return error.code;
  if (error instanceof ActionIdentityAdjudicationError) return error.code;
  if (error instanceof RoutingPlanCandidateValidationError) {
    return error.failures[0]?.code ?? "FINAL_PLAN_INVALID";
  }
  return "PROVIDER_OR_OUTPUT_FAILURE";
}

const Sorted = z.object({
  clean: z
    .string()
    .describe(
      "the capture in the person's own words, tidied — an EDIT, never a rewrite. Fix punctuation, casing and obvious transcription garble; drop pure filler (um, uh, false starts). APPLY spoken self-corrections instead of transcribing them: when the speaker corrects themselves — 'not AI, just Retake', 'I mean Tuesday' — keep only the corrected reading. Collapse restarts: a clause said twice while the speaker found their footing appears once. 'For Retake AI, I need to check, not AI, just Retake. I need to check how it works right now' becomes 'For Retake, I need to check how it works right now.' The exact words are always preserved in the person's record, so removing dictation noise loses nothing — but the line between noise and content is sacred: never swap in synonyms, never summarise, never drop an idea, never change a number, a name or a claim, and when unsure whether something is a correction or a new thought, keep both. Break it into short paragraphs separated by a blank line, one per distinct idea. Use '- ' bullets on their own lines wherever they are listing things. Never return one unbroken block."
    ),
  kind: z.enum(["action", "thread", "intention", "both"]).describe(
    "semantic role of the capture. " + SEMANTIC_KIND_BOUNDARY +
    "An Intention is a chosen way of being or living; a Thread is for observation or inquiry—one or more observations or inquiries that develop thought; an Action is a concrete commitment with a source-stated finish line. " +
    "Use thread for developing thought, action for one or more Actions, and both only when developing thought and a concrete Action coexist. Destination topology does not decide the semantic role."
  ),
  title: z.string().describe("max 6 words"),
  actions: z
    .array(z.string())
    .describe(
      "imperative one-line items for discrete requested or committed acts with a source-stated finish line. Apply the completion test: after doing it once, could the person mark it done from the result named in the capture? If not, it is not an Action. An ongoing scope for noticing, tracking, documenting, learning, or understanding belongs in a Thread even when the person says they want to keep doing it. Each item must be readable on its own a week later with none of the capture around it — the subject goes IN the line, never left behind as \"this\" or \"that\""
    ),
  primaryActions: z.array(z.string()).describe(
    "Exact strings from actions that are genuinely about the PRIMARY thread subject; empty for unrelated tasks. Co-occurrence in one capture is NOT a relationship. With annual pricing thinking plus a Stripe webhook retry bug and call mom this weekend, primaryActions is empty. Select only a pricing task if one is also present. Never include tasks about an also subject."
  ),
  shelfLife: z.enum(["hours", "days", "weeks", "keep"]),
  due: z
    .string()
    .nullable()
    .describe(
      "ISO date or date-time explicitly named for a single action (resolve relative words against today). Null with multiple actions: this scalar cannot identify which task owns the deadline. Preserve each task's stated timing in its action text. Never broadcast one task's date to siblings"
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
      "For kind both, ONLY the thinking about the primary thread, excluding unrelated errands even when also is empty. When also is used, ONLY the primary subject; the words in also must not appear here. Keep clean as the whole capture. Null only for an unsplit single-kind capture."
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
      "one entry per FURTHER THINKING SUBJECT, not per task. Never duplicate extracted actions here, even with null destinations. A genuine secondary deliberation may open a new thread. Empty when there is only one thinking subject, even if there are unrelated errands"
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

const CorrectionExample = z.object({
  capture: z.string().min(1).max(160),
  kind: z.enum(["action", "thread", "intention"]),
  threadId: z.string().max(100).optional(),
  threadName: z.string().max(100).optional(),
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
  /** Planned clients assign this before any model call. */
  captureId: z.string().min(1).max(100).optional(),
  raw: z.string(),
  threads: z.array(
    z.object({ id: z.string(), name: z.string(), about: z.string() })
  ),
  /** Versioned planning seam used only after the client durably saves intake. */
  routingPlanVersion: z.literal(1).optional(),
  /** The one-call sorter (lib/simpleSort). */
  sortVersion: z.literal(SIMPLE_SORT_VERSION).optional(),
  /** The person's Date#getTimezoneOffset(), so "Friday" means their Friday. */
  tzOffset: z.number().int().min(-900).max(900).optional(),
  /** Existing open Actions are candidates only for dedicated identity adjudication. */
  actions: z.array(
    z.object({ id: z.string().min(1).max(100), text: z.string().min(1).max(500) })
  ).max(400).optional(),
  /** How this person has filed their recent captures — pattern context. */
  recent: z.array(Recent).max(40).optional(),
  /** The set this capture plausibly continues, decided by the client from
      shape and timing (lib/series.ts). A named default, not an order. */
  series: z
    .object({ threadId: z.string(), threadName: z.string(), minutesAgo: z.number() })
    .optional(),
  /** Explicit user corrections, bounded and advisory. They are examples for
      the model to generalize from, never executable phrase rules. */
  correctionExamples: z.array(CorrectionExample).max(5).optional(),
  /** The destination is already decided; only the wording is in question. */
  force: z.enum(["action", "thread", "intention"]).optional(),
  /** Up to four attached photos (data URLs), each captioned independently by
      a one-image vision request before the sort. Bounded to the size a shrunk
      photo actually reaches — a hand-built multi-megabyte payload has no
      business in a sort request. */
  imgs: z.array(z.string()).max(4).optional(),
});

/**
 * Revalidate correction evidence against the request's current destination
 * inventory and project it onto the semantic fields only. Display metadata
 * such as the visible `text` label never becomes model context, and stale or
 * malformed Thread choices quietly stop influencing a sort.
 */
function boundedCorrectionEvidence(
  body: z.infer<typeof Body>,
): NonNullable<z.infer<typeof Body>["correctionExamples"]> {
  const liveThreads = new Map(body.threads.map((thread) => [thread.id, thread.name]));
  const evidence: NonNullable<z.infer<typeof Body>["correctionExamples"]> = [];
  for (const example of body.correctionExamples ?? []) {
    if (example.kind !== "thread") {
      evidence.push({ capture: example.capture, kind: example.kind });
      continue;
    }
    if (!example.threadId || !liveThreads.has(example.threadId)) continue;
    evidence.push({
      capture: example.capture,
      kind: "thread",
      threadId: example.threadId,
      threadName: liveThreads.get(example.threadId),
    });
  }
  return evidence;
}

/**
 * Ask a vision-capable tier what a photo shows, in one sentence. Returns null
 * when no vision tier is configured or the call fails; callers treat that as
 * incomplete image evidence and leave the capture pending.
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
    /* Missing image meaning is represented as null and fails the sort closed. */
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

/** Bounded corrections, injected as examples for the model to interpret. */
function correctionContext(examples: z.infer<typeof Body>["correctionExamples"]) {
  if (!examples?.length) return "";
  const lines = examples
    .map((example) => {
      const destination =
        example.kind === "thread" && example.threadId
          ? `threadId "${example.threadId}"${
              example.threadName ? ` ("${example.threadName}")` : ""
            }`
          : `kind "${example.kind}"`;
      return `- "${example.capture}" was corrected to ${destination}.`;
    })
    .join("\n");
  return (
    "\nThe person corrected these earlier captures. Treat them as bounded " +
    "semantic examples, not phrase rules: generalize only when the present " +
    "capture means the same kind of thing. Shared words alone are not evidence:\n" +
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


const FILING_REQUEST_RULE = `
Present filing requests to Capture:
- Identify who should act: Capture now, or the person later.
- When someone asks Capture to file a passage in a supplied existing Thread, honor that destination for that passage.
- For that request, use kind thread for classification or developing_thought in a plan. Its chosen destination overrides the inferred kind only for its scoped content.
- Do not make the filing instruction an Action. Keep the instruction and its scoped content together for exact source accounting.
- Do not apply that destination to unrelated passages.
- Quoted instructions, hypothetical examples, and reminders to file later are not immediate filing requests.
- A Thread name alone is not a filing instruction. Keep ordinary classification and new-Thread rules unchanged.
`;

const SUBJECT_CHECK = `
Final subject check:
- Identify each independent subject before choosing its destination. Shared timing, an attachment, or a general label such as "improvements" does not make subjects related.
- Destination shape does not change semantic kind. If every independent claim is developing thought, set the top-level kind to thread whether the shares reuse existing Threads, need new Thread names, or mix both.
- Distinguish what the speaker wants an external subject or project to become from how the speaker chooses to live. The former is developing thought; only the latter is an Intention.
- For kind "thread" or "both", separate subjects that have different goals and would be read in different places. A website's navbar and a posting strategy are separate subjects. Navbar spacing and its mobile menu are parts of one navigation goal.
- The absence of existing threads does not change the subject count. Reuse a fitting thread for each share. Otherwise give that share its own short threadName. Never invent an umbrella name to avoid a split.
- For a split, put the primary subject's words in primaryText and each other subject's words in also. Each share needs a valid threadId or a specific threadName. Name the primary thread only for its share, not the whole capture.
- Keep clean as the whole capture. Preserve every idea across the shares without copying unrelated material between them.
- An attached-photo description is evidence for the subject it depicts, not another subject. Make that subject primary and keep its photo description in primaryText. Do not omit the description or put it in the unrelated share.
- A list of steps toward one goal stays together. Ordinary errands stay separate actions, not artificial threads. Never put action-only material in also, even with null destinations; it already lives in actions. A forced kind chooses the kind, not the number of subjects.
- With multiple actions, set due to null: the single date field cannot identify its owner. Keep each stated date in the corresponding action line, never inherit a sibling task's date.
`;

function prompt(
  raw: string,
  threads: z.infer<typeof Body>["threads"],
  force?: "action" | "thread" | "intention",
  recent?: z.infer<typeof Recent>[],
  correctionExamples?: z.infer<typeof Body>["correctionExamples"]
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
      "Fill actions with every distinct, explicit task as an imperative one-line item — the thing to actually do, not a description of the thinking around it. Never invent a task or duplicate one. Keep clauses describing the same task together. If only one thing is genuinely doable, return one.\n" +
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
      "\nSet clean to the excerpt tidied up, and title to at most six words." +
      SUBJECT_CHECK
    );
  }
  if (force === "intention") {
    return (
      "This is an excerpt from someone's running notes, and they have already declared an intention — a state they are calling into being about themselves or their life, spoken as a wish, a resolve, or an aspiration. Not a task to close out, not a subject to think about.\n\n" +
      'Excerpt:\n"""' +
      raw +
      '"""\n\n' +
      'Set kind to "intention". Set "actions" and "primaryActions" to []. Leave both thread fields null.\n' +
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
    correctionContext(correctionExamples) +
    seriesContext(series) +
    '\nRaw capture:\n"""' +
    (raw || "(image only)") +
    '"""\n\n' +
    SEMANTIC_KIND_BOUNDARY +
    'There are four kinds. The reference examples below are your guide for telling them apart.\n' +
    'kind = "action" when this is a task, errand, reminder, or decision that gets closed out — there is a concrete thing to do and a source-stated finish line. Before returning any Action, apply the completion test: after doing it once, could the person mark it done from the result named in the capture? A discrete requested act such as an errand, delivery, booking, message, or purchase is still an action when phrased as a want. Fill "actions" with every distinct, explicit task actually being asked for as an imperative one-line item, and leave the thread fields null. Never pad the list: if only one thing is genuinely doable, return one.\n' +
    'kind = "thread" when this is thinking, worldbuilding, an idea being developed, or material that accumulates — a subject to keep adding to, with no single thing to do. A desire to keep noticing, tracking, documenting, learning about, or understanding a subject is developing thought, not a task, unless the person separately requests a discrete act that can be completed. The words "I want to" do not decide the kind; distinguish what they want to keep exploring from what they have actually asked to do. Set threadId if one clearly fits, otherwise invent a short threadName. Leave "actions" empty.\n' +
    'kind = "intention" only when they are declaring a chosen way of being or living — what they are calling into being about themselves or their life. A concise present-tense declaration can be an Intention without wish, hope, or future-tense language. Decide by semantic role rather than sentence form: values, permissions, personal stances, and self-directed resolves choose how to live; reporting or questioning what is true is developing thought for a Thread. A concrete commitment with a source-stated finish line is an Action. For an Intention, set "actions" and "primaryActions" to [] and leave every Thread destination null.\n' +
    'An intention is the ESSENCE of a state — a sentence or two. A detailed PLAN is not one, however much it is spoken in "I will": the moment the words carry schedules, counts, quantities, exercise lists, or step-by-step structure ("I will run twice a week for 30 to 40 minutes, do push-ups, dips and pull-ups, walk 10,000 steps, keep to 500-600 calories, and organize my schedule around it"), the person is DESIGNING a routine, not declaring a state — that is thinking that accumulates, so it is a thread. Filing a plan as an intention throws the plan away: the intention keeps only a condensed sentence, and paragraphs of specifics the person dictated are lost. When a capture holds both a true declaration AND its detailed plan, the plan is the primary thing — file it as the thread, and let the person declare the one-line intention separately if they want it. Length is the cheapest tell: multiple paragraphs are almost never an intention.\n' +
    'kind = "both" when the capture carries a line of thinking the person is still turning over AND a concrete task to close — typically a deadline or a commitment to someone. Filing it as only an action throws the thinking away; filing it as only a thread buries the task. So do both: fill "actions" with the task(s), set threadId (route to an existing thread when one fits) or threadName for the thinking, and "primaryText" holds only the thinking for the thread fragment while "clean" retains the whole capture, including every task. The tell is a capture where one part is a decision/idea/deliberation and another part is a dated or promised thing to do. Do not use "both" for pure thinking with no committed task (that is a thread), or for a plain task with no real deliberation around it (that is an action).\nA capture can hold MORE than two kinds — a task, a question being turned over, and a rule the person is setting for themselves, all in one breath. There is no shape for three, and the failure to avoid is quietly picking one and dropping the rest: a capture that plainly contains something to do must never come back as a bare thread with an empty actions list. When a capture holds a task and anything else at all, use "both", put every task in "actions", and let "primaryText" carry the primary thinking and any standing rule about that subject. Keep every subject and task in "clean", with other thinking subjects in "also", so nothing the person said loses its place.\n' +
    'Every action must stand on its own. A week from now it will be read as a single line on a list, with none of the words around it — so it has to carry its own subject. Take the context from the capture and put it IN the action: not "Have engineering handle this" but "Have engineering handle the verification workflow"; not "Create workflows" but "Create workflows so agents ship without me reviewing"; not "Fix this bug" but "Fix the mis-sorting into the wrong threads". If you cannot tell what an action refers to when you read it alone, it is not finished.\n' +
    'This is the most common way the list goes wrong: a sentence gets chopped at its clauses and each fragment becomes an item. "Stop over building. Create workflows and have engineering handle this. Do all the verification and checks." is ONE thought about how to work — at most one action, carrying the whole of what it asks. Three stubs from three clauses is a worse answer than one complete line.\n' +
    'Do NOT choose "intention" for an ordinary errand phrased as a want ("I want to get milk" is an action), or for thinking about a topic ("been reading about sleep cycles" is a thread).\n' +
    'Before you answer "thread", run one check: did they commit to something? A person named, a day or date, a thing owed or promised — "I told Marc I would demo it on Friday", "I said I would send Jen the outline by Monday". The sentence around it can be pure deliberation and the commitment still stands: it does not stop being a promise because they were thinking out loud when they made it. If the capture holds one, the answer is "both", never "thread" — filing it as a thread loses the promise, which is the one part with a deadline on it. A date that belongs to the SUBJECT rather than to them ("the deadline for the grant is in March", "their launch is next week") is not a commitment and does not make it "both".\n' +
    'The check runs on what they SAID, never on what you would advise. An observation is not a decision: "the 4am waking seems worse after late screens" notices a pattern, it does not commit anyone to cutting screens, and turning it into "Try cutting screens before bed" invents a task they never set. Noticing what might help is thinking. An ongoing investigation, note-keeping scope, or hoped-for understanding has no finish line and stays thinking; never turn what the person wants to keep learning, observing, or documenting over time into a fabricated task. A grammatically imperative rewrite does not make it completable. If the only action you can produce is one you thought of, there is no action and the answer is "thread".\n' +
    'Be conservative, not eager. Only make an action when the capture actually asks for something to be done; never invent a task that is not there. Do not treat a concise declaration as ambiguous merely because it is present tense; decide whether it chooses a way of living or reports something to explore. Only when that semantic role remains genuinely ambiguous choose "thread". When a capture is only thinking, choose "thread" — but when it clearly holds both a keepable line of thinking and a concrete task, "both" is right, so nothing is lost on either side.\n\n' +
    'Reference examples:\n' +
    '- "gotta call the dentist tomorrow and remember to buy milk on the way home" → kind "action", actions: ["Call the dentist tomorrow", "Buy milk on the way home"]\n' +
    '- "booked the flights, remember to sort out travel insurance" → kind "action", actions: ["Sort out travel insurance"]\n' +
    '- "was thinking about whether this project is worth continuing, weighing pros and cons" → kind "thread", threadName: "Is this project worth continuing"\n' +
    '- "been reading about sleep cycles and how they affect productivity" → kind "thread", threadName: "Sleep cycles and productivity"\n' +
    '- "the seedlings recover faster after shade; I want to keep notes on which corners stay coolest through summer" → kind "thread", actions: [], threadName: "Seedling shade observations". Keeping an open-ended record defines what accumulates in the Thread; it is not a finishable Action.\n' +
    '- "I want to write down today\'s nursery temperatures and send the list to Mina" → kind "action", actions: ["Write down today\'s nursery temperatures", "Send Mina the nursery temperature list"]. These have stated one-time results and can be completed.\n' +
    '- "still turning over whether to leave the agency, the dread every sunday is real — anyway I need to tell them my decision on the raise by friday" → kind "both", actions: ["Tell the agency my decision on the raise by Friday"], threadName: "Whether to leave the agency"\n' +
    '- "not sure the podcast idea is worth it, keep circling it, anyway I promised jen I\'d send her the draft outline by monday" → kind "both", actions: ["Send Jen the draft outline by Monday"], threadName: "Is the podcast idea worth it"\n' +
    '- "I want to wake up at 6 and actually feel rested" → kind "intention"\n' +
    '- "I live somewhere with light" → kind "intention"\n\n' +
    "shelfLife is how long this stays worth looking at, and it only applies to actions. Judge it honestly:\n" +
    '- "hours" for something tied to today: a call to return, a thing to grab on the way home.\n' +
    '- "days" for ordinary errands and small follow-ups.\n' +
    '- "weeks" for real work that takes a while: drafting, building, contacting someone properly.\n' +
    '- "keep" for commitments to other people, money, deadlines, or anything with consequences if it silently vanished. When unsure, choose "keep".' +
    DUE_RULE +
    SUBJECT_CHECK + FILING_REQUEST_RULE
  );
}

function immutableIndexedSourceLedger(raw: string): string {
  const characters = [...raw];
  const chunks: string[] = [];
  const chunkSize = 48;
  for (let start = 0; start < characters.length; start += chunkSize) {
    const end = Math.min(start + chunkSize, characters.length);
    chunks.push(`[${start},${end}) ${JSON.stringify(characters.slice(start, end).join(""))}`);
  }
  const exactCharacters = characters.flatMap((character, characterOffset) => {
    if (/^[\p{L}\p{N} ]$/u.test(character)) return [];
    const codePoint = character.codePointAt(0)!;
    return [
      `[${characterOffset}] U+${codePoint.toString(16).toUpperCase().padStart(4, "0")} ${JSON.stringify(character)}`,
    ];
  });
  return (
    "Immutable indexed source ledger (Unicode code-point offsets; this is the copying authority):\n" +
    "Contiguous exact chunks:\n" + chunks.join("\n") + "\n" +
    "Exact punctuation, controls, marks, and symbols:\n" +
    (exactCharacters.length ? exactCharacters.join("\n") : "(none)") + "\n"
  );
}

function routingPlanPrompt(
  raw: string,
  body: z.infer<typeof Body>,
  failures: RoutingPlanFailure[],
  initialInterpretation: z.infer<typeof Sorted>,
): string {
  const retryGuidance = [
    failures.some((failure) => failure.code === "INTENTION_NOT_DECLARED_ALONE")
      ? "\nINTENTION_NOT_DECLARED_ALONE repair: This capture says several things, and the affected item is not named as an intention by the person. Intentions are declared on their own, not pulled out of a longer capture. Re-decide the affected item from the source as a developing_thought (with its Thread destination) or an Action, or keep it with the thought it belongs to.\n"
      : "",
    failures.some((failure) => failure.code === "NON_THOUGHT_DESTINATION")
      ? "\nNON_THOUGHT_DESTINATION repair: Re-evaluate each affected item's semantic kind from the original source before changing its fields. Do not mechanically clear destinations just to satisfy validation: if the destinations reflect genuine developing thought, correct the kind; if the source truly requests or commits a discrete act, keep action and clear destinations. The model still owns that semantic decision.\n"
      : "",
    failures.some((failure) => failure.code === "DEADLINE_NOT_ATOMIC")
      ? "\nDEADLINE_NOT_ATOMIC repair: A due-bearing Action must be represented by two adjacent owned items, not by putting due on the Action. Action.due must be null. Give the Action item only its exact non-deadline source slice. Add one deadline item whose ownerId is that Action id, whose due is the resolved ISO date, and whose source is the exact complete due-bearing source—including the relative phrase, punctuation, and adjacent separator whitespace—represented once. Do not change the Action meaning, invent timing, merge sibling deadlines, or attach a deadline to Actions outside its exact semantic scope. For one phrase explicitly shared by several Actions, keep one deadline source and declare its additionalOwnerIds.\n"
      : "",
    failures.some((failure) => failure.code === "SOURCE_NOT_ACCOUNTED")
      ? "\nSOURCE_NOT_ACCOUNTED repair: Rebuild the ordered source boundaries against the original string. Concatenating item.source must reproduce it exactly. Each sourceMismatch identifies the first differing Unicode character: at characterOffset, copy expected exactly instead of received; null means that side ended. Then audit the complete remainder, not only that character. Preserve every non-whitespace character unchanged and in order; never paraphrase, normalize punctuation, infer, overlap, or reorder. Preserve separator whitespace exactly once, assigning whitespace between adjacent items to the end of the preceding item.source.\n"
      : "",
  ].join("");
  const feedback = failures.length
    ? `\nThe previous plan was rejected for these exact integrity failures:\n${JSON.stringify(failures)}\n${retryGuidance}Return a corrected complete plan.\n`
    : "";
  return (
    todayLine() +
    RELATIVE_DUE_RULE +
    "PLANNED ROUTING STAGE\n" +
    "Convert the initial interpretation into one complete source-owned plan. Check it against the original source and stable Thread/correction context. It is advisory, not authoritative: correct an interpretation only when the original source supports the change. Do not write to the board.\n\n" +
    `Initial interpretation (advisory):\n${JSON.stringify(initialInterpretation)}\n\n` +
    `Original source (preserve it exactly):\n${JSON.stringify(raw)}\n\n` +
    immutableIndexedSourceLedger(raw) +
    "Copy item.source only from the indexed ledger. Do not substitute typographic punctuation, normalize Unicode, or retype from memory. Use the chunk ranges and exact-character checkpoints to audit every boundary before returning.\n\n" +
    SEMANTIC_KIND_BOUNDARY +
    `Every existing Thread, with its complete bounded routing brief:\n${JSON.stringify(body.threads)}\n\n` +
    "Existing open Actions are intentionally withheld from this mixed-purpose stage. Extract every explicit Action and decide every item kind from the source itself. A later dedicated stage receives the open Actions and may decide only whether each proposed Action is new or names an existing Action id.\n\n" +
    `Bounded full-capture correction examples:\n${JSON.stringify(body.correctionExamples ?? [])}\n` +
    "\nComplete JSON contract (return exactly one JSON object; no prose, Markdown, code fences, or extra keys):\n" +
    "- Root: { items, newThreads }. items is an array of 1..30 AtomicItem objects. newThreads is an array of 0..8 NewThread objects.\n" +
    "- AtomicItem has: id, source, kind, action, due, ownerId, destinations, duplicateActionId, unresolved, ambiguity, and optional additionalOwnerIds.\n" +
    "- id: non-empty string, max 80 characters. source: non-empty string, max 8000 characters.\n" +
    "- kind is exactly one of: action, developing_thought, intention, supporting_context, deadline. An action is a direct instruction or commitment to a discrete task. An imperative addresses the person implicitly and does not need a named actor or date. An ordinary review or check can finish once. A developing_thought is an observation, question, explanation, design idea, option under consideration, or problem the person is trying to understand. Thinking about what might work does not adopt a personal stance. An intention is an explicitly adopted lasting personal principle, identity, or way of living; it is not an ordinary intention to investigate, compare, decide, or change a project. Intentions are declared on their own: when the capture says several things, use intention only for a part the person explicitly calls an intention; any other sentence of resolve belongs with the thought or Action around it. Classify the whole semantic thought before dividing its source for bookkeeping. Keep its reasoning and qualifying clauses with that thought unless the source actually changes subject or speech act. Use supporting_context and deadline only for source owned by another item.\n" +
    "- action: null or non-empty string max 500. due: null or non-empty string max 40. ownerId: null or non-empty string max 80. Action.due must always be null. Only a separate deadline item may carry due, as a resolved ISO date, and its ownerId must name one Action item. Optional additionalOwnerIds is an array of 0..28 unique additional Action ids, each max 80 characters, allowed only on deadline items (omit or [] otherwise). Declare every Action in the exact semantic scope of a genuinely shared deadline phrase; do not repeat ownerId in this array. Exclude Actions with different local dates; represent their local deadlines separately. Each Action may own at most one deadline.\n" +
    "- destinations: array of 0..4 Destination objects. Each Destination is exactly either { type: \"existing\", threadId: <non-empty string max 100> } or { type: \"new\", newThreadKey: <non-empty string max 80> }. Only developing_thought items may carry destinations; all other kinds must use an empty destinations array. Preserve the semantic kind and clear destinations when the source is not developing thought; use developing_thought only when that is what the source means.\n" +
    "- duplicateActionId is reserved for a later dedicated Action identity adjudicator. Always return null. unresolved: boolean. ambiguity: null or non-empty string max 240.\n" +
    "- NewThread has exactly: key, name, closestExistingThreadId, whyNew. key: non-empty string max 80. name: non-empty string max 100. closestExistingThreadId: null or non-empty string max 100. Use null only when the supplied Threads list is empty. Otherwise, choose the closest supplied Thread id, even if it is unrelated, and explain the difference. whyNew: non-empty string max 300.\n" +
    (body.force
      ? `Explicit user destination command: ${body.force}. This is authoritative, not an advisory classification. All primary items must use ${body.force === "thread" ? "developing_thought" : body.force}; supporting_context may only support that kind, and deadline items are allowed only for an Action command. Preserve the exact source; do not substitute another kind.\n`
      : "") +
    feedback +
    "\nBuild the plan in this order:\n" +
    "1. Partition the original source into meaningful items in original order. Keep one idea and its explanation, uncertainty, purpose, or qualifications together. Do not turn each sentence or subordinate clause into a separate item. Split when the source changes subject or speech act, or when a deadline must name its Action owner. An indivisible shared thought may have several destinations. Copy exact source slices, including punctuation and separator whitespace, so concatenating every item.source equals the original byte for byte. Never omit, overlap, reorder, paraphrase, or invent source.\n" +
    "2. Independently decide the final item kinds and explicit Actions from the original source. Every explicit Action must appear exactly once and no source may be turned into an invented Action. Do not suppress or reclassify an explicit Action because it may duplicate an open Action; Action identity is decided only after this plan is validated. For every due-bearing Action, create an Action item with due null and represent its deadline separately. A phrase genuinely shared by several Actions appears once as one deadline item: ownerId names one Action and additionalOwnerIds names the exact remaining owners; deadline.due carries the resolved ISO date; deadline.source owns the exact complete deadline wording from the original, including a relative phrase such as a day reference, its punctuation, and its one share of adjacent whitespace. Do not leave deadline wording inside the Action source, copy it into two sources, combine distinct deadline phrases, or put due on the Action. Do not infer sharing from position alone or copy the advisory scalar due onto siblings. Supporting context points to the item it supports.\n" +
    "3. Route each developing thought to every Thread where it genuinely belongs. Multiple destinations are normal. Use all Thread briefs above; do not choose by word overlap. If no existing Thread fits, declare one newThreads entry with the closest existing Thread and a concrete semantic reason it is different. Never propose a paraphrase of an existing Thread.\n" +
    "4. If an affected source part is genuinely ambiguous, set unresolved true, give a short ambiguity reason, and leave its destinations empty. Never force ambiguity into a Thread. Do not create supporting Actions for an Intention; only explicit Action source may become an Action.\n" +
    "5. Keep exact existing ids. New Thread keys are request-local. Do not return explanations outside the schema.\n" +
    "6. Before returning, perform two independent ownership audits. Destination ownership: inspect each developing_thought item by itself. Give it only destinations that own that exact item.source. Another subject elsewhere in the same capture is never evidence for another destination; for independent thoughts, do not copy or union destination sets across items. Action/deadline ownership: inspect each deadline together with every explicitly owning Action. Confirm that ownerId plus additionalOwnerIds names exactly the intended scope, excluding Actions with differing local dates, and that due exactly resolves that deadline.source under today's calendar rules. Recompute relative weekdays as the next occurrence strictly after today; do not copy or union dates or owners across sibling Actions unless the original phrase actually shares that deadline across those exact Actions." +
    (body.force ? "" : FILING_REQUEST_RULE)
  );
}

export async function POST(request: Request) {
  const planningDeadlineAt = Date.now() + PLANNING_DEADLINE_MS;
  const planningAbortSignal = AbortSignal.timeout(PLANNING_DEADLINE_MS);
  const authorization = await authorizeManagedAiRequest(request);
  if (authorization instanceof Response) return authorization;
  return withManagedAiAdmission(authorization, async () => {
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
  body = { ...body, correctionExamples: boundedCorrectionEvidence(body) };

  if (!body.raw.trim()) {
    return Response.json({ error: "nothing to sort" }, { status: 400 });
  }
  if (body.routingPlanVersion === 1 && !body.captureId) {
    return Response.json({ error: "bad request" }, { status: 400 });
  }
  if (body.imgs?.some((source) => !parseSortImageDataUrl(source))) {
    return Response.json({ error: "bad request" }, { status: 400 });
  }
  if (
    body.routingPlanVersion === 1 &&
    (body.imgs?.length ||
      body.raw.length > 20_000 ||
      body.threads.length > 60 ||
      body.threads.some((thread) =>
        thread.id.length > 100 || thread.name.length > 200 || thread.about.length > 1_200
      ))
  ) {
    return Response.json({ error: "bad request" }, { status: 400 });
  }

  if (body.sortVersion === SIMPLE_SORT_VERSION) {
    if (body.imgs?.length || body.raw.length > 20_000) {
      return Response.json({ error: "bad request" }, { status: 400 });
    }
    try {
      const now = Date.now();
      /* Clean and lay out first, then sort the readable version. The words as
         captured stay in the record (the ledger's raw); a failed or doubtful
         formatting keeps them as they are. */
      const raw = shouldFormat(body.raw)
        ? await withFallback((tier) => formatCapture(body.raw, { tier, abortSignal: planningAbortSignal }), preferredFor("sort"), { abortSignal: planningAbortSignal })
          .then((result) => result.value, () => body.raw)
        : body.raw;
      const prompt = simpleSortPrompt({
        raw, threads: body.threads, actions: body.actions, corrections: body.correctionExamples, force: body.force, now, tzOffset: body.tzOffset,
      });
      const { value, via } = await withFallback(async (tier) =>
        normalizeSimpleSort(
          await generateSimpleSort({ tier, prompt, abortSignal: planningAbortSignal }),
          { threads: body.threads, actions: body.actions, force: body.force, raw, now, tzOffset: body.tzOffset },
        ), preferredFor("sort"), { abortSignal: planningAbortSignal });
      /* A run-on action becomes its separate short tasks (only long ones are sent). */
      const items = await withFallback((tier) => tightenActions(value, { tier, abortSignal: planningAbortSignal }), preferredFor("sort"), { abortSignal: planningAbortSignal })
        .then((result) => result.value, () => value);
      return Response.json({ sort: { version: SIMPLE_SORT_VERSION, items }, via });
    } catch (e) {
      const { message, status } = explain(e);
      return Response.json({ error: message }, { status });
    }
  }

  /* Providers accept one image at this seam. Interpret each attachment in its
     own bounded call and preserve attachment order in the sort evidence;
     never drop extras or ask one caption to invent a combined meaning. */
  let raw = body.raw;
  if (body.imgs?.length) {
    if (!visionChain().length) {
      return Response.json({ error: "The sort didn't go through." }, { status: 503 });
    }
    const captions = await Promise.all(body.imgs.map(captionImage));
    if (captions.some((caption) => !caption)) {
      return Response.json({ error: "The sort didn't go through." }, { status: 503 });
    }
    raw = mergeCaptions(body.raw, captions as string[]);
  }

  try {
    const { value, via, preferred, fallback, fallbackReason } = await withFallback(async (tier) => {
      try {
        const { object } = await generateObject({
          model: tier.model,
          // A spent free tier reports "retry in 26s"; fail fast so the chain
          // can fall through to the next provider instead of making the user
          // wait out the backoff.
          maxRetries: 0,
          abortSignal: planningAbortSignal,
          schema: Sorted,
          temperature: 0,
          prompt: prompt(
            raw,
            body.threads,
            body.force,
            body.recent,
            body.correctionExamples,
            body.series
          ),
          providerOptions: tier.providerOptions,
        });
        routingStageEvent({
          stage: "recovery",
          providerTier: tier.name as RoutingProviderTier,
          result: "accepted",
          code: "SUCCESS",
          itemCount: null,
          decisionCount: null,
        });
        return object;
      } catch (error) {
        routingStageEvent({
          stage: "recovery",
          providerTier: tier.name as RoutingProviderTier,
          result: "rejected",
          code: routingStageCode(error, planningAbortSignal),
          itemCount: null,
          decisionCount: null,
        });
        throw error;
      }
    }, preferredFor("sort"), { abortSignal: planningAbortSignal });
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
    const standing =
      !body.force
        ? enforceStandingDecision(raw, { kind, actions, threadId, threadName })
        : { kind, actions, threadId, threadName };
    /* A model can understand an explicit lasting decision yet still choose a
       Thread because the prompt's uncertainty rule is deliberately
       conservative. Clear durable commitments get one deterministic final
       check; typed commands still outrank it. */
    const recovery = reconcileSorted({
      ...value,
      ...standing,
      // A series override can change the thinking destination. The
      // model's action selection vouched for its original home, not this one.
      primaryActions: standing.threadId === value.threadId && standing.threadName === value.threadName
        ? value.primaryActions : [],
    });
    /* P3 opts in only after durable local intake. The raw validated plan is
       returned for pending-only client settlement; the compiled preview stays
       for evaluation compatibility. Images remain client-owned throughout. */
    let reconciled: typeof recovery | PlannedSortResult = recovery;
    let finalVia = via;
    let finalRouting = { preferred, fallback, fallbackReason };
    let routingPlan: z.infer<typeof PlannedRoutingPlanSchema> | undefined;
    if (body.routingPlanVersion === 1) {
      const planningContext = {
        captureId: body.captureId!,
        raw: body.raw,
        force: body.force,
        threads: body.threads,
        actions: body.actions ?? [],
        recovery,
        now: Date.now(),
      };
      let plannedVia = via;
      let plannedRouting = finalRouting;
      const validated = await planRoutingWithRetry(
        planningContext,
        async (failures, validateCandidate) => {
          const remainingMs = planningDeadlineAt - Date.now();
          if (remainingMs <= 0) throw new Error("planned routing deadline elapsed");
          const generated = await withFallback(async (tier) => {
            try {
              const untrusted = await generatePlannedRoutingCandidate({
                tier,
                abortSignal: planningAbortSignal,
                prompt: routingPlanPrompt(body.raw, body, failures, recovery),
              });
              const candidate = validateCandidate!(untrusted);
              routingStageEvent({
                stage: "planner",
                providerTier: tier.name as RoutingProviderTier,
                result: "accepted",
                code: "SUCCESS",
                itemCount: candidate.items.length,
                decisionCount: null,
              });
              return candidate;
            } catch (error) {
              routingStageEvent({
                stage: "planner",
                providerTier: tier.name as RoutingProviderTier,
                result: "rejected",
                code: routingStageCode(error, planningAbortSignal),
                itemCount: error instanceof RoutingPlanCandidateValidationError &&
                  error.failures.every((failure) => failure.itemId)
                  ? new Set(error.failures.map((failure) => failure.itemId)).size
                  : null,
                decisionCount: null,
              });
              throw error;
            }
          }, preferredFor("sort"), { abortSignal: planningAbortSignal });
          plannedVia = generated.via;
          plannedRouting = {
            preferred: generated.preferred,
            fallback: generated.fallback,
            fallbackReason: generated.fallbackReason,
          };
          return generated.value;
        },
        (observation) => {
          routingValidationEvent(observation);
        },
        { validateInsideGenerate: true },
      );
      let stagedPlan = validated.plan;
      if (requiresPlannedDestinationOwnership(stagedPlan)) {
        const stageInput = stagedPlan;
        const destinationCount = stageInput.items.filter((item) =>
          item.kind === "developing_thought" && !item.unresolved
        ).length;
        const destinationGenerated = await withFallback(async (tier) => {
          try {
            const adjudicated = await adjudicatePlannedDestinationOwnership({
              plan: stageInput,
              context: planningContext,
              correctionExamples: (body.correctionExamples ?? []).flatMap((example) =>
                example.kind === "thread" && example.threadId
                  ? [{
                      capture: example.capture,
                      threadId: example.threadId,
                      ...(example.threadName ? { threadName: example.threadName } : {}),
                    }]
                  : []
              ),
              generate: async (destinationPrompt) => {
                const remainingMs = planningDeadlineAt - Date.now();
                if (remainingMs <= 0) throw new Error("planned routing deadline elapsed");
                return generatePlannedDestinationOwnershipCandidate({
                  tier,
                  abortSignal: planningAbortSignal,
                  prompt: destinationPrompt,
                });
              },
            });
            routingStageEvent({
              stage: "destination_adjudication",
              providerTier: tier.name as RoutingProviderTier,
              result: "accepted",
              code: "SUCCESS",
              itemCount: adjudicated.items.length,
              decisionCount: destinationCount,
            });
            return adjudicated;
          } catch (error) {
            routingStageEvent({
              stage: "destination_adjudication",
              providerTier: tier.name as RoutingProviderTier,
              result: "rejected",
              code: routingStageCode(error, planningAbortSignal),
              itemCount: stageInput.items.length,
              decisionCount: destinationCount,
            });
            throw error;
          }
        }, preferredFor("sort"), { abortSignal: planningAbortSignal });
        if (destinationGenerated.fallback || !plannedRouting.fallback) {
          plannedVia = destinationGenerated.via;
          plannedRouting = {
            preferred: destinationGenerated.preferred,
            fallback: destinationGenerated.fallback,
            fallbackReason: destinationGenerated.fallbackReason,
          };
        }
        stagedPlan = destinationGenerated.value;
      }
      if (requiresPlannedActionIdentity(stagedPlan, planningContext)) {
        const stageInput = stagedPlan;
        const actionCount = stageInput.items.filter((item) =>
          item.kind === "action" && item.action && !item.unresolved
        ).length;
        const actionGenerated = await withFallback(async (tier) => {
          try {
            const adjudicated = await adjudicatePlannedActionIdentity({
              plan: stageInput,
              context: planningContext,
              generate: async (actionPrompt) => {
                const remainingMs = planningDeadlineAt - Date.now();
                if (remainingMs <= 0) throw new Error("planned routing deadline elapsed");
                return generatePlannedActionIdentityCandidate({
                  tier,
                  abortSignal: planningAbortSignal,
                  prompt: actionPrompt,
                });
              },
            });
            routingStageEvent({
              stage: "action_identity",
              providerTier: tier.name as RoutingProviderTier,
              result: "accepted",
              code: "SUCCESS",
              itemCount: adjudicated.items.length,
              decisionCount: actionCount,
            });
            return adjudicated;
          } catch (error) {
            routingStageEvent({
              stage: "action_identity",
              providerTier: tier.name as RoutingProviderTier,
              result: "rejected",
              code: routingStageCode(error, planningAbortSignal),
              itemCount: stageInput.items.length,
              decisionCount: actionCount,
            });
            throw error;
          }
        }, preferredFor("sort"), { abortSignal: planningAbortSignal });
        if (actionGenerated.fallback || !plannedRouting.fallback) {
          plannedVia = actionGenerated.via;
          plannedRouting = {
            preferred: actionGenerated.preferred,
            fallback: actionGenerated.fallback,
            fallbackReason: actionGenerated.fallbackReason,
          };
        }
        stagedPlan = actionGenerated.value;
      }
      if (requiresPlannedDeadlineAdjudication(stagedPlan)) {
        const planningTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const stageInput = stagedPlan;
        const deadlineGenerated = await withFallback(async (tier) => {
          try {
            const adjudicated = await adjudicatePlannedDeadlines({
              plan: stageInput,
              context: planningContext,
              timeZone: planningTimeZone,
              generate: async (deadlinePrompt) => {
                const remainingMs = planningDeadlineAt - Date.now();
                if (remainingMs <= 0) throw new Error("planned routing deadline elapsed");
                return generatePlannedDeadlineAdjudicationCandidate({
                  tier,
                  abortSignal: planningAbortSignal,
                  prompt: deadlinePrompt,
                });
              },
            });
            routingStageEvent({
              stage: "deadline_adjudication",
              providerTier: tier.name as RoutingProviderTier,
              result: "accepted",
              code: "SUCCESS",
              itemCount: adjudicated.items.length,
              decisionCount: adjudicated.items.filter((item) => item.kind === "deadline").length,
            });
            return adjudicated;
          } catch (error) {
            routingStageEvent({
              stage: "deadline_adjudication",
              providerTier: tier.name as RoutingProviderTier,
              result: "rejected",
              code: routingStageCode(error, planningAbortSignal),
              itemCount: stageInput.items.length,
              decisionCount: stageInput.items.filter((item) => item.kind === "deadline").length,
            });
            throw error;
          }
        }, preferredFor("sort"), { abortSignal: planningAbortSignal });
        if (deadlineGenerated.fallback || !plannedRouting.fallback) {
          plannedVia = deadlineGenerated.via;
          plannedRouting = {
            preferred: deadlineGenerated.preferred,
            fallback: deadlineGenerated.fallback,
            fallbackReason: deadlineGenerated.fallbackReason,
          };
        }
        stagedPlan = deadlineGenerated.value;
      }
      routingPlan = stagedPlan;
      reconciled = compileRoutingPlan(stagedPlan, planningContext);
      finalVia = plannedVia;
      finalRouting = plannedRouting;
    }
    /* Jev is an opt-in shadow only. It receives the already-isolated thinking
       share, never images/history/rules, runs after this response, and cannot
       change the destination. A failed shadow therefore leaves both the
       successful filing path and the existing unsorted failure path intact. */
    const jevCapture =
      reconciled.kind === "thread"
        ? reconciled.primaryText?.trim() || reconciled.clean.trim()
        : reconciled.kind === "both"
          ? reconciled.primaryText?.trim()
          : undefined;
    if (
      body.routingPlanVersion !== 1 &&
      (reconciled.kind === "thread" || reconciled.kind === "both") &&
      jevCapture
    ) {
      await scheduleJevThreadRerankShadow({
        capture: jevCapture,
        candidates: body.threads,
        sorterThreadId: reconciled.threadId,
        sorterCreatedNewThread: !reconciled.threadId,
      }, { authorization });
    }
    return Response.json({
      ...value,
      ...reconciled,
      ...(routingPlan ? { routingPlan, recovery } : {}),
      via: finalVia,
      routing: finalRouting,
    });
  } catch (error) {
    /* AI SDK errors can carry the full request body, including the person's
       capture. Keep server logs useful without turning them into a second,
       invisible copy of what someone said. */
    opsEvent({ event: "managed_ai_route", outcome: "failure", reason: sanitizeProviderError(error), count: "one" });
    const { message, status } = explain(error);
    return Response.json({ error: message }, { status });
  }
  });
}
