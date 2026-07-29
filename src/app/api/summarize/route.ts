import { generateText } from "ai";
import { z } from "zod";

/**
 * Keeps a thread's "Where this stands" block current.
 *
 * Called after a fragment lands on a thread, with that thread's whole history
 * — the summary is rewritten from scratch each time rather than patched, so it
 * never drifts away from what the fragments actually say.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = "anthropic/claude-sonnet-5";

const Body = z.object({
  name: z.string(),
  frags: z.array(z.object({ at: z.number(), text: z.string() })),
});

export async function POST(request: Request) {
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch {
    return Response.json({ error: "bad request" }, { status: 400 });
  }

  try {
    const { text } = await generateText({
      model: MODEL,
      prompt:
        'These are dated fragments one person captured over time about "' +
        body.name +
        '", oldest first:\n\n' +
        body.frags
          .map((f) => "[" + new Date(f.at).toDateString() + "] " + f.text)
          .join("\n\n") +
        '\n\nWrite a "Where this stands" block: 3-5 sentences of plain prose describing what this idea currently is, what\'s been settled, and what\'s still open. Write it back to them in their own register. Invent nothing. Return only the prose.',
    });
    return Response.json({ summary: text.trim() });
  } catch (error) {
    console.error("summarize failed", error);
    return Response.json({ error: "summarize failed" }, { status: 502 });
  }
}
