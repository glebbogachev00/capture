import { generateObject } from "ai";
import { z } from "zod";

import { clientIp } from "@/lib/clientIp";
import { modelRateLimit } from "@/lib/limiter";
import { withFallback } from "@/lib/providers";
import { preferredFor } from "@/lib/routing";

/**
 * The judge — does this candidate mean anything?
 *
 * The local scan finds shared WORDS. That is all it has ever found, and on
 * a real board it was wrong more often than right: "Publish articles and
 * quotes on X" was offered a home in "Reducing friction strategy" because
 * both said "articles quotes"; "Create a portfolio for Dom" was called a
 * copy of "Mention to the parent that Dom has two lessons left". Tightening
 * the thresholds fixed the symptom by making the scan quieter — four claims
 * instead of eleven — but a quieter word-matcher is still a word-matcher,
 * and the seven it stopped saying included three it should have said.
 *
 * So the scan stops talking to people. It generates candidates, loosely and
 * for free, and this route decides which of them are real. Word overlap is
 * a good way to find pairs worth looking at and a bad way to decide, which
 * is exactly the division of labour here: recall from the scan, precision
 * from a model that can read what the notes actually say.
 *
 * The reason a person sees comes from here too, and that is half the point.
 * "Both mention small sound effects" is not a reason — it is the evidence
 * restated. "Both are notes about the demo you are recording" is one.
 *
 * One request for the whole batch: a dozen short judgements cost less than
 * a dozen round trips, and the whole thing has to finish inside the sixty
 * seconds every route in this app gets.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

/** More than this and the panel was never going to be readable anyway. */
const MAX_CANDIDATES = 14;
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s);

const Body = z.object({
  candidates: z
    .array(
      z.object({
        id: z.string(),
        /* What is being claimed, in the app's own vocabulary. */
        kind: z.string(),
        /* The thing that would move, go, or be folded. */
        source: z.string(),
        /* Where it would end up, or what it supposedly repeats. */
        target: z.string(),
        /* What is already in the destination, so the model can tell a
           shared subject from a shared word. */
        targetContext: z.string().optional(),
      })
    )
    .min(1)
    .max(MAX_CANDIDATES),
});

/* Candidates are numbered 1..N for the model, not addressed by their real
   ids. The real ones are composites like "fold_action:eb7qyemt:f12eovu2",
   and asking a model to echo a random-looking string exactly is a coin
   flip: the first run came back with ids that matched nothing, every
   verdict was filtered out, and the route reported an empty result that
   looked exactly like "the model rejected all of them". A small integer it
   can copy without thinking removes the whole class of mistake. */
const Verdicts = z.object({
  verdicts: z.array(
    z.object({
      n: z.number().int().describe("the candidate's number, exactly as given"),
      keep: z.boolean(),
      /* Required-but-nullable: Groq's structured output needs every
         property in `required`, and an optional one is dropped from it. */
      reason: z
        .string()
        .nullable()
        .describe(
          "why this is real, in words the person can check against their own notes — null when keep is false"
        ),
    })
  ),
});

const PROMPT = `You are deciding which of these suggestions are real.

Each one was found by a program that only compares words. It has no idea what anything means, and it is wrong more often than it is right — that is why you are here. Your job is to keep the ones that would make sense to the person who wrote these notes, and drop the rest.

Judge by IDEA, never by wording:
- Two notes that share a phrase but say different things are NOT related. "Publish articles and quotes on X" and a thread about reducing friction both contain "articles quotes" and have nothing to do with each other. Drop it.
- Two notes that share no words at all can still be one thought. That is what you can see and the program cannot.
- "Duplicate" means the same task twice, not two tasks about one subject. "Add sound effects to the demo" and "create demo transitions" are two different pieces of work. Drop it.
- A note belongs in a thread when it is ABOUT that thread's subject and would be read alongside what is already there. Sharing a word with the thread's name is not belonging.

Dropping is the normal answer. Most of these are coincidences, and a suggestion that is wrong teaches the person to ignore every suggestion after it. Keeping nothing is a good outcome.

For each one you keep, write a reason the person can check against their own words — what the two things actually have in common. Never say "both mention X"; a shared word is the thing you were asked to see past, not a reason. If the only reason you can give is a shared phrase, do not keep it.

Return a verdict for every candidate, using its number.

The candidates:
`;

function render(
  c: z.infer<typeof Body>["candidates"][number],
  n: number
): string {
  return [
    `${n}. claim: ${c.kind}`,
    `  this: ${clip(c.source, 400)}`,
    `  against: ${clip(c.target, 400)}`,
    c.targetContext
      ? `  what is already there: ${clip(c.targetContext, 700)}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
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
        schema: Verdicts,
        prompt:
          PROMPT +
          body.candidates.map((c, i) => render(c, i + 1)).join("\n\n"),
        providerOptions: tier.providerOptions,
      });
      return object;
    }, preferredFor("judge"));

    /* Map numbers back to the ids the caller knows. A verdict for a number
       nobody offered is noise; a candidate with no verdict is dropped,
       because silence is not agreement. */
    const verdicts = value.verdicts
      .filter((v) => v.n >= 1 && v.n <= body.candidates.length)
      .map((v) => ({
        id: body.candidates[v.n - 1].id,
        keep: v.keep,
        reason: v.reason,
      }));

    /* Answering about nothing is a failure, not a unanimous rejection.
       Reported as one, the caller shows an empty panel and everyone
       believes the model considered these and said no. */
    if (!verdicts.length) {
      return Response.json({ error: "no usable judgement" }, { status: 503 });
    }

    return Response.json({ verdicts, via });
  } catch {
    /* The caller decides what to do without a judgement — it falls back to
       the strict local scan rather than showing nothing. */
    return Response.json({ error: "no judgement" }, { status: 503 });
  }
}
