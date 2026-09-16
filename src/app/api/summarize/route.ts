import { generateText } from "ai";
import { z } from "zod";
import { explain } from "@/lib/aiError";
import { clientIp } from "@/lib/clientIp";
import { modelRateLimit } from "@/lib/limiter";
import { withFallback } from "@/lib/providers";
import { THREAD_SUMMARY_SYSTEM } from "@/lib/threadSummaryPrompt";
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
  /** The other threads on the board, by name.
   *
   * Routing is a comparison, but every summary has been written in
   * isolation, so no thread could ever say "that goes next door" — it had
   * never been told next door existed. Measured on a real board, the sorter
   * could not tell two threads apart precisely because both described
   * themselves as being about the same app. A thread needs to know its
   * neighbours to describe its own edges. */
  siblings: z.array(z.string()).max(40).optional(),
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
        system: THREAD_SUMMARY_SYSTEM,
        prompt: JSON.stringify(body),
        providerOptions: tier.providerOptions,
      });
      return text;
    });
    const { summary, next, belongs } = splitNext(value);
    return Response.json({ summary, next, belongs, via });
  } catch (error) {
    console.error("summarize failed", error);
    const { message, status } = explain(error);
    return Response.json({ error: message }, { status });
  }
}
