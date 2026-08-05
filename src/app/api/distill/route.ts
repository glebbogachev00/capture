import { generateObject, streamText } from "ai";
import { z } from "zod";
import { explain } from "@/lib/aiError";
import { clientIp } from "@/lib/clientIp";
import { modelRateLimit } from "@/lib/limiter";
import { NoProvidersError, chain, withFallback } from "@/lib/providers";
import { countAssistantQuestions } from "@/lib/distill";

/**
 * Distill — the clarifying engine.
 *
 * Four ops on one route:
 *   - "chat": stream back the next clarifying turn, given the transcript so
 *     far. Quiet, one question at a time.
 *   - "settle": run the finished transcript through the sort schema so the
 *     conversation becomes an action, thread, or intention — the same shape
 *     /api/sort returns, so the client files it with the exact same code.
 *   - "polish": proofread the wording about to be filed. Spoken conversation
 *     carries speech-to-text artifacts (misheard words, run-on words, dropped
 *     punctuation), so the settle output gets one final correction pass at
 *     save time — fix the artifacts, never invent or drop content.
 *   - "proofread": the same light check for a typed edit (a fragment or
 *     action the user just rewrote). Fixes typos and slips; never rewrites.
 *
 * The prompt lives here rather than in the browser for the same reason the
 * sort prompt does: it can't be rewritten by whatever is on the client.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

const Turn = z.object({
  role: z.enum(["user", "assistant"]),
  text: z.string(),
});

const Body = z.discriminatedUnion("op", [
  z.object({ op: z.literal("chat"), turns: z.array(Turn) }),
  z.object({ op: z.literal("settle"), turns: z.array(Turn) }),
  z.object({
    op: z.literal("polish"),
    clean: z.string(),
    actions: z.array(z.string()),
    turns: z.array(Turn),
  }),
  z.object({ op: z.literal("proofread"), text: z.string().max(4000) }),
]);

const Settled = z.object({
  clean: z.string().describe(
    "the conversation distilled to what it actually settled: cleaned wording in the speaker's voice, every idea kept, nothing invented"
  ),
  kind: z.enum(["action", "thread", "intention"]),
  title: z.string().describe("max 6 words"),
  actions: z.array(z.string()).describe("imperative one-line items when kind is action"),
  shelfLife: z.enum(["hours", "days", "weeks", "keep"]),
});

const Polished = z.object({
  clean: z.string().describe(
    "the same wording, corrected: transcription artifacts fixed, nothing invented, nothing dropped"
  ),
  actions: z.array(z.string()).describe(
    "the same one-line action items, corrected the same way"
  ),
});

const Proofread = z.object({
  text: z.string().describe(
    "the same text, corrected: only clear typos and slips fixed, nothing invented, nothing dropped, nothing reworded"
  ),
});

const CLARIFIER = `You are the clarifying engine inside capture, a personal thinking app. The user has a half-formed thought. Your job is to get to the bottom of it — by proposing what it is, not by interrogating.

After every user turn, your first move is to state the record you would file: name the kind and the shape of it, in one or two plain sentences. For example: "I'd file this as a thread about whether to leave the job — it says you're burned out, but the money's good. Right?" The draft is how you show understanding; the user reads it, corrects it, or confirms it.

The only question you may ask is a confirmation question about that draft — "is it X or Y?", "does that match?", "right?". Never ask an open-ended probe ("what do you mean?", "tell me more") — a half-formed thought gets a draft, not a questionnaire.

After every user turn:
1. State the record you would file.
2. If a real ambiguity remains about the draft, ask the ONE confirmation question that resolves it. Never more than one.
3. When you are confident, or the user confirms the draft, ask nothing. Close with one short line — always write it, even when the user just confirmed — then end your reply with the marker [ready] on its own line, so the app knows the conversation can be filed. Say nothing after it.

Rules you never break:
- Never restate, summarize, or re-read the user's words back at them. Ever. The draft is a new framing, not an echo.
- The draft is yours, not theirs: never lift the user's wording into it. Say the record in your own words, even when theirs were short and self-contained.
- Redundancy is restating: never append the user's own sentence after a dash, comma, or colon as an explanation of the draft. If the record is already stated, close — a trailing echo adds nothing.
- A confirmation word from the user — "yes", "right", "that's it", "correct", "exactly", "sounds good" — must produce [ready] on your next reply, never a new question. Confirming the draft ends the conversation.
- Never ask more than two questions across the whole conversation. A third question means you are not listening; close instead, however rough.
- One question at a time, short replies of one to three sentences.
- The marker is a hard either/or: a reply that asks a question must NOT contain [ready] — the app lights up "Distill" when it sees [ready], so pairing it with a question would tell the user the conversation is finished and then ask them to keep going. A question gets no marker; only a reply with nothing left to ask gets [ready].
- It is better to close on an approximate record the user can correct in review than to keep asking. The review step exists exactly for that — a rough record beats a long interrogation.
- Plain language. No lists, no bullets, no labels, no "great question".

A note on question-counting: the app counts your questions mechanically and tells you how many you have already asked. That number is a hard budget, not a suggestion — when the budget is spent, you have no questions left, and you close with [ready] however rough the record is.`;

const SETTLER = `You are the settling engine inside capture. A person has just had a clarifying conversation, and it is your job to turn the whole exchange into exactly one record of one of three kinds.

- "action" when the conversation converged on something to close: a task, errand, decision, or commitment — a concrete thing to do.
- "thread" when it converged on thinking to accumulate: an idea being developed, material for something, a topic still growing — with no single thing to do.
- "intention" only when they declared something they are calling into being about themselves or their life — a state to live in, not a task and not a subject to think about. When torn between thread and intention, choose thread.

Be conservative, not eager. Only make an action when the conversation actually settled on something to do; never invent a task that was not said. When torn between action and thread, choose thread — nothing gets lost there.

The "clean" field is the whole conversation distilled: what it settled on, written in their voice, with their specifics kept and nothing invented. Break it into short paragraphs or bullets where it lists things, like the sort engine does.

Set "actions" to the one to three imperative items actually agreed on when kind is action, otherwise empty.

Reference examples:
- "So the plan is to call the vet about Luna's shots, and I should also grab cat food this week" → "action", actions: ["Call the vet about Luna's shots", "Buy cat food this week"]
- "I keep going back and forth on whether to start a newsletter and what it would even be about" → "thread"
- "I want to actually enjoy my mornings instead of dreading them" → "intention"

shelfLife is how long this stays worth looking at, and it only applies to actions:
- "hours" for something tied to today.
- "days" for ordinary errands and small follow-ups.
- "weeks" for real work that takes a while.
- "keep" for commitments to other people, money, deadlines, or anything with consequences if it silently vanished. When unsure, choose "keep".`;

const POLISHER = `You are the proofreading pass inside capture, a personal thinking app. A person had a spoken conversation that speech-to-text transcribed, and the engine distilled it to the wording below.

Speech-to-text leaves artifacts in that wording: words it misheard, dropped or doubled words, filler like "um" and "like" and "you know", missing or wrong punctuation, and run-on words ("whatdoyoumean").

Your job is to fix those artifacts and nothing else:
- Correct clear transcription errors and restore normal punctuation and casing.
- Keep every idea, every number, every name, every specific detail.
- Do not add new content, do not reorder ideas, do not change the speaker's voice.
- Keep roughly the same length and structure. If the wording is already clean, return it unchanged.

Fix the distilled wording and, if present, the one-line action items the same way.`;

const PROOFREADER = `You are a light proofreading pass inside capture, a personal thinking app. The user typed the text below into a note (or edited an existing note), and it is about to be saved.

Your job is to fix clear slips and nothing else:
- Misspelled words ("fragmnet" → "fragment", "recieve" → "receive").
- Doubled words ("the the"), run-on words ("whatdoyoumean"), and words run together without a space.
- Obvious grammar slips that hurt readability.

Never do anything else:
- Do not rewrite, restructure, reorder, or reword. Do not add or remove content.
- Never "fix" a word just because it is unfamiliar. In this app, unusual words are almost always names, brands, jargon, or deliberate spelling ("Mlue", "GurrenGrow", "Hermes", "Kokoro", "Jim", "Distill", "Capture") — leave every such word exactly as written, including its casing.
- Only correct a word when the intended word is unmistakable from the misspelling alone ("recieve" → "receive", "kitchin" → "kitchen", "expresso" → "espresso"). When in doubt, leave the word alone.
- Preserve the user's capitalization and punctuation style — a lowercase note stays lowercase, a note with no periods stays without them. Only fix words that are clearly misspelled.
- Keep roughly the same length. If the text is already clean, return it exactly unchanged.`;

function transcript(turns: { role: string; text: string }[]) {
  return turns
    .map((t, i) => (t.role === "user" ? "You said" : "The assistant said") + ` [${i}]: ${t.text}`)
    .join("\n\n");
}

export async function POST(request: Request) {
  // Distill spends real model quota; a single client can't run it in a loop.
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

  // Only the turn-based ops need a transcript; proofread takes a bare text.
  if (body.op !== "proofread") {
    if (!body.turns.length) {
      return Response.json({ error: "nothing to say yet" }, { status: 400 });
    }
    // The settle op feeds the whole transcript to the model in one call; cap
    // its size so a runaway client can't burn quota in a single request.
    const totalChars = body.turns.reduce((n, t) => n + t.text.length, 0);
    if (body.turns.length > 100 || totalChars > 40_000) {
      return Response.json(
        { error: "That conversation is too long to distil in one go." },
        { status: 400 }
      );
    }
  }

  /* ------------------------------ chat ------------------------------ */

  if (body.op === "chat") {
    const last = body.turns[body.turns.length - 1];
    if (last.role !== "user") {
      return Response.json({ error: "bad request" }, { status: 400 });
    }
    // Captured before the generator: a closure does not keep the narrowed
    // union member, and the turn ops are the only ones with `turns`.
    const turns = body.turns;

    /* The question budget, computed not imagined: count how many questions
       the assistant has already asked in the transcript, and turn the number
       into a hard instruction. The 2-question cap used to be prose the model
       could drift past; now the code counts and the model only obeys. */
    const asked = countAssistantQuestions(turns);
    let system = CLARIFIER;
    if (asked >= 1) {
      system += `\n\nYou have already asked ${asked} question${asked === 1 ? "" : "s"} across this conversation. Ask no more.`;
    }
    if (asked >= 2) {
      system += `\n\nReply [ready] — the user has answered enough.`;
    }

    // Stream the reply through the provider chain. A tier that fails before
    // producing a single chunk is replaced by the next one; a tier that dies
    // mid-answer ends the reply instead — retrying would interleave a second
    // provider's text into a partial first one.
    async function* streamWithFallback(): AsyncGenerator<string> {
      const tiers = chain();
      if (!tiers.length) throw new NoProvidersError();

      let emitted = false;
      let lastError: unknown;
      for (const tier of tiers) {
        try {
          const { textStream } = await streamText({
            model: tier.model,
            // A spent free tier reports "retry in 26s"; don't make the user
            // wait on backoff for a provider that can't answer — fail fast
            // and let the next tier in the chain take the call.
            maxRetries: 0,
            providerOptions: tier.providerOptions,
            system,
            messages: turns.map((t) => ({
              role: t.role,
              content: t.text,
            })),
          });
          for await (const chunk of textStream) {
            emitted = true;
            yield chunk;
          }
          // A tier that produced no text at all is as dead as one that
          // errored — spent quota can come back as an empty stream rather
          // than a thrown error, and treating it as an answer would end the
          // whole reply instead of falling through to the next provider.
          if (!emitted) {
            lastError = new Error(
              `${tier.name} returned an empty stream`
            );
            console.warn(`[capture] distill ${tier.name} empty, trying next`);
            continue;
          }
          return;
        } catch (error) {
          if (emitted) throw error;
          lastError = error;
          console.warn(`[capture] distill ${tier.name} failed, trying next`, error);
        }
      }
      throw lastError;
    }

    const encoder = new TextEncoder();
    const gen = streamWithFallback();

    // Pull the first chunk before the Response exists. A provider that fails
    // outright then becomes a JSON error (the client keeps it out of the
    // transcript), not an error sentence baked into a 200 stream.
    let first: IteratorResult<string>;
    try {
      first = await gen.next();
    } catch (error) {
      console.error("distill chat failed", error);
      const { message } = explain(error);
      return Response.json({ error: message }, { status: 502 });
    }
    if (first.done) {
      return Response.json(
        { error: "The model returned nothing. Try again." },
        { status: 502 }
      );
    }

    // A failure after the first chunk errors the stream instead of retrying a
    // second tier mid-sentence — interleaving two providers' text would be
    // worse than the one that died. The client's catch drops the turn.
    const stream = new ReadableStream({
      async start(controller) {
        try {
          controller.enqueue(encoder.encode(first.value));
          for await (const chunk of gen) {
            controller.enqueue(encoder.encode(chunk));
          }
        } catch (error) {
          console.error("distill chat failed mid-stream", error);
          controller.error(error);
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  /* ----------------------------- polish ----------------------------- */

  if (body.op === "polish") {
    try {
      const { value, via } = await withFallback(async (tier) => {
        const { object } = await generateObject({
          model: tier.model,
          maxRetries: 0,
          schema: Polished,
          system: POLISHER,
          prompt:
            transcript(body.turns) +
            "\n\nDistilled wording to proofread:\n" +
            body.clean +
            (body.actions.length
              ? "\n\nAction items:\n" +
                body.actions.map((a, i) => `${i + 1}. ${a}`).join("\n")
              : ""),
          providerOptions: tier.providerOptions,
        });
        return object;
      });
      return Response.json({ ...value, via });
    } catch (error) {
      console.error("polish failed", error);
      const { message, status } = explain(error);
      return Response.json({ error: message }, { status });
    }
  }

  /* ---------------------------- proofread --------------------------- */

  if (body.op === "proofread") {
    try {
      const { value, via } = await withFallback(async (tier) => {
        const { object } = await generateObject({
          model: tier.model,
          maxRetries: 0,
          schema: Proofread,
          system: PROOFREADER,
          prompt: body.text,
          providerOptions: tier.providerOptions,
        });
        return object;
      });
      return Response.json({ ...value, via });
    } catch (error) {
      console.error("proofread failed", error);
      const { message, status } = explain(error);
      return Response.json({ error: message }, { status });
    }
  }

  /* ----------------------------- settle ----------------------------- */

  try {
    const { value, via } = await withFallback(async (tier) => {
      const { object } = await generateObject({
        model: tier.model,
        maxRetries: 0,
        schema: Settled,
        system: SETTLER,
        prompt: transcript(body.turns),
        providerOptions: tier.providerOptions,
      });
      return object;
    });
    return Response.json({ ...value, via });
  } catch (error) {
    console.error("settle failed", error);
    const { message, status } = explain(error);
    return Response.json({ error: message }, { status });
  }
}
