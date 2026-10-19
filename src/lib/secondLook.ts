import { z } from "zod";

/**
 * A second look before a thought starts a new thread.
 *
 * The sort decides what a capture holds and names a thread for each thought
 * from each thread's description. When none seems to fit it starts a new
 * thread, and the person often moved those into one they already had:
 * descriptions miss what a thread is about right now. The thread's own latest
 * note shows that, but adding it to the sort reshuffled which tasks it picked
 * out. So it goes to a small separate call, asked only when the sort is about
 * to start a new thread: "does this continue one of these?". On the person's
 * refiled captures that call was right every time it moved a would-be new
 * thread, and no better than a coin flip at second-guessing an existing one,
 * so it never does that. Code accepts an existing thread or nothing; nothing
 * keeps the new thread.
 */

export const FILE_SYSTEM =
  "Someone just captured a note in their notes app. Decide which ONE of their existing threads it continues. " +
  "Each thread has a name, what belongs in it, and the start of the note they last added there. Judge by what " +
  "the note is about and what they are working on, not by shared words. If the capture says where it goes " +
  "(\"add this to X\"), that thread is the answer. If no thread holds this subject, the answer is null. " +
  "Return JSON {\"threadId\": string | null}.";

type Brief = { id: string; name: string; about: string };

export function filingPrompt(note: string, raw: string, threads: Brief[], latest: Record<string, string>): string {
  const candidates = threads.map(({ id, name, about }) => ({
    id, name, about: about.slice(0, 300), ...(latest[id] ? { latest: latest[id] } : {}),
  }));
  return [
    `Threads:\n${JSON.stringify(candidates)}`,
    "",
    note.trim() === raw.trim()
      ? `The note:\n${JSON.stringify(note)}`
      : `The capture:\n${JSON.stringify(raw)}\n\nThe note to file (part of that capture):\n${JSON.stringify(note)}`,
  ].join("\n");
}

const Answer = z.object({ threadId: z.string().nullable() });

/** An existing thread's id, or null to keep the new thread. */
export function acceptFiling(answer: unknown, threads: Brief[]): string | null {
  const parsed = Answer.safeParse(answer);
  if (!parsed.success || !parsed.data.threadId) return null;
  return threads.some((thread) => thread.id === parsed.data.threadId) ? parsed.data.threadId : null;
}
