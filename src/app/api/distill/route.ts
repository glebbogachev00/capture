import { generateObject, streamText } from "ai";
import { z } from "zod";
import { explain } from "@/lib/aiError";
import { clientIp } from "@/lib/clientIp";
import { modelRateLimit } from "@/lib/limiter";
import { NoProvidersError, chain, withFallback } from "@/lib/providers";

/**
 * Distill — the clarifying engine.
 *
 * Two ops on one route:
 *   - "chat": stream back the next clarifying turn, given the transcript so
 *     far. Quiet, one question at a time.
 *   - "settle": run the finished transcript through the sort schema so the
 *     conversation becomes an action, thread, or intention — the same shape
 *     /api/sort returns, so the client files it with the exact same code.
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

const CLARIFIER = `You are the clarifying engine inside capture, a personal thinking app. The user has a half-formed thought. Your job is to help them get to the bottom of it by asking — not by sorting, and not by writing it for them.

Rules you never break:
- One question at a time. Short replies, one to three sentences.
- Ask about what is genuinely unclear: what they mean, what is missing, what they actually want to happen. Never ask for its own sake.
- When the thought is close to clear, say so briefly and stop ("I think I've got it — Distill when you're ready.").
- If a question would make them repeat themselves, don't ask it.
- Plain language. No lists, no bullets, no labels, no "great question".`;

const SETTLER = `You are the settling engine inside capture. A person has just had a clarifying conversation, and it is your job to turn the whole exchange into exactly one record of one of three kinds.

- "action" when the conversation converged on something to close: a task, errand, decision, or commitment.
- "thread" when it converged on thinking to accumulate: an idea being developed, material for something, a topic still growing.
- "intention" only when they declared something they are calling into being about themselves or their life — a state to live in, not a task and not a subject to think about. When torn between thread and intention, choose thread.

The "clean" field is the whole conversation distilled: what it settled on, written in their voice, with their specifics kept and nothing invented. Break it into short paragraphs or bullets where it lists things, like the sort engine does.

Set "actions" to 1-4 imperative one-line items when kind is action, otherwise empty.

shelfLife is how long this stays worth looking at, and it only applies to actions:
- "hours" for something tied to today.
- "days" for ordinary errands and small follow-ups.
- "weeks" for real work that takes a while.
- "keep" for commitments to other people, money, deadlines, or anything with consequences if it silently vanished. When unsure, choose "keep".`;

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

  /* ------------------------------ chat ------------------------------ */

  if (body.op === "chat") {
    const last = body.turns[body.turns.length - 1];
    if (last.role !== "user") {
      return Response.json({ error: "bad request" }, { status: 400 });
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
            system: CLARIFIER,
            messages: body.turns.map((t) => ({
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
