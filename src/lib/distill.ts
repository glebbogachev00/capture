/**
 * Distill — a focused conversation before anything is filed.
 *
 * The transcript is a first-class record, not render state: it lives in
 * IndexedDB under its own key and is written after every turn, so a
 * half-finished conversation survives a reload and a mobile background kill —
 * the same "never lose a capture" guarantee as the board itself.
 */

export const DISTILL_KEY = "capture:distill:v1";

export type DistillTurn = {
  role: "user" | "assistant";
  text: string;
  at: number;
};

export type DistillSession = {
  id: string;
  at: number;
  turns: DistillTurn[];
};

export const EMPTY_DISTILL: DistillSession = { id: "", at: 0, turns: [] };

/** What the settling engine decided the conversation became. */
export type DistillResult = {
  clean: string;
  kind: "action" | "thread" | "intention";
  title: string;
  actions?: string[];
  shelfLife?: string;
  threadId?: string | null;
  threadName?: string | null;
  /** Which model tier settled it — recorded in the capture ledger. */
  via?: string;
};

/**
 * The settle policy lives beside the transcript model so its role boundary is
 * explicit and unit-testable. The API route passes this string unchanged to
 * the model.
 */
export const DISTILL_SETTLER_SYSTEM = `You are the settling engine inside capture. A person has just had a clarifying conversation, and it is your job to turn the whole exchange into exactly one record of one of three kinds.

- "action" when the conversation converged on something to close: a task, errand, decision, or commitment — a concrete thing to do.
- "thread" when it converged on thinking to accumulate: an idea being developed, material for something, a topic still growing — with no single thing to do.
- "intention" only when they declared something they are calling into being about themselves or their life — a state to live in, not a task and not a subject to think about. When torn between thread and intention, choose thread.

Be conservative, not eager. Only make an action when the conversation actually settled on something to do; never invent a task that was not said. When torn between action and thread, choose thread — nothing gets lost there.

Authorship is a hard boundary. Only the user's turns can authorize an action. Assistant filing proposals are context only, never evidence for an action. Do not turn an assistant phrase such as "I'd file this as feedback" into work for the user.

Feedback or discussion with no explicit user-owned next step is a thread, even when it is long, detailed, critical, or about how Capture should behave. Preserve the feedback in "clean" and leave "actions" empty. Talking about a product problem is not by itself a commitment to fix it.

When the user genuinely and explicitly owns or requests a next step, make each action short, direct, and user-facing: name the outcome they should produce. Never write an internal filing instruction such as "File this feedback under a category", "Categorize the conversation", or "Save this as product feedback". Those describe the engine's bookkeeping, not the user's work.

The "clean" field is the whole conversation distilled: what it settled on, written in their voice, with their specifics kept and nothing invented. Break it into short paragraphs or bullets where it lists things, like the sort engine does.

Set "actions" to the one to three imperative items actually agreed on when kind is action, otherwise empty.

Reference examples:
- "So the plan is to call the vet about Luna's shots, and I should also grab cat food this week" → "action", actions: ["Call the vet about Luna's shots", "Buy cat food this week"]
- "I keep going back and forth on whether to start a newsletter and what it would even be about" → "thread"
- A long conversation critiquing Capture's handling of feedback, with the assistant proposing where to file it but no user commitment to change it → "thread", actions: []
- The user explicitly says they will correct that behavior → "action", actions: ["Fix Capture's distill behavior for long feedback conversations"]
- "I want to actually enjoy my mornings instead of dreading them" → "intention"

shelfLife is how long this stays worth looking at, and it only applies to actions:
- "hours" for something tied to today.
- "days" for ordinary errands and small follow-ups.
- "weeks" for real work that takes a while.
- "keep" for commitments to other people, money, deadlines, or anything with consequences if it silently vanished. When unsure, choose "keep".`;

/**
 * How many questions the assistant has already asked so far in a transcript.
 *
 * A turn counts as a question when its trimmed text ends with "?". This is
 * the number the chat route turns into a hard budget in the prompt — the
 * cap stops being prose the model can drift past, because the code counts
 * and the model only obeys. Purely structural on purpose: no sentiment,
 * no parsing, so it is deterministic and unit-testable.
 */
export function countAssistantQuestions(
  turns: { role: string; text: string }[]
): number {
  let n = 0;
  for (const t of turns) {
    if (t.role !== "assistant") continue;
    const text = t.text?.trim();
    if (text && text.endsWith("?")) n++;
  }
  return n;
}

/** Fill in anything a saved session is missing, dropping malformed turns. */
export function hydrateDistill(raw: string | null | undefined): DistillSession {
  if (!raw) return EMPTY_DISTILL;
  try {
    const d = JSON.parse(raw) as Partial<DistillSession> | null;
    if (!d || !Array.isArray(d.turns)) return EMPTY_DISTILL;
    const turns: DistillTurn[] = [];
    for (const t of d.turns) {
      if (
        t &&
        (t.role === "user" || t.role === "assistant") &&
        typeof t.text === "string"
      ) {
        turns.push({
          role: t.role,
          text: t.text,
          at: typeof t.at === "number" ? t.at : 0,
        });
      }
    }
    return {
      id: typeof d.id === "string" ? d.id : "",
      at: typeof d.at === "number" ? d.at : 0,
      turns,
    };
  } catch {
    return EMPTY_DISTILL;
  }
}
