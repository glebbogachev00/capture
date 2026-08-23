import { generateText } from "ai";
import { z } from "zod";
import { explain } from "@/lib/aiError";
import { clientIp } from "@/lib/clientIp";
import { modelRateLimit } from "@/lib/limiter";
import { withFallback } from "@/lib/providers";
import { splitNext } from "@/lib/nextStep";

/**
 * Keeps a thread's "Where this stands" block current.
 *
 * Called after a fragment lands on a thread, with that thread's whole history
 * — the summary is rewritten from scratch each time rather than patched, so it
 * never drifts away from what the fragments actually say.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({
  name: z.string(),
  frags: z.array(z.object({ at: z.number(), text: z.string() })),
  /** What is already on their list, so the step is never a repeat. */
  open: z.array(z.string()).optional(),
});

export async function POST(request: Request) {
  // Summarising spends real model quota; a single client can't run it in a loop.
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
      const { text } = await generateText({
        model: tier.model,
        maxRetries: 0,
        prompt:
        'These are dated fragments one person captured over time about "' +
        body.name +
        '", oldest first:\n\n' +
        body.frags
          .map((f) => "[" + new Date(f.at).toDateString() + "] " + f.text)
          .join("\n\n") +
          '\n\nWrite a "Where this stands" block: 3-5 sentences of plain prose describing what this idea currently is, what\'s been settled, and what\'s still open. Write it back to them in their own register. Invent nothing.' +
          '\n\nThen, on its own last line, write NEXT: followed by the one concrete step the fragments point at — a decision the evidence has made, a person to write back to, a thing to send or ship — in their words, at most one short sentence, something they could do today. If the fragments point at nothing in particular, write NEXT: none; a step you would have to invent is worse than none. Never suggest something already on their list' +
          (body.open?.length ? ':\n' + body.open.map((a) => '- ' + a).join('\n') : '.') +
          '\n\nReturn only the prose and that last line.',
        providerOptions: tier.providerOptions,
      });
      return text;
    });
    const { summary, next } = splitNext(value);
    return Response.json({ summary, next, via });
  } catch (error) {
    console.error("summarize failed", error);
    const { message, status } = explain(error);
    return Response.json({ error: message }, { status });
  }
}
