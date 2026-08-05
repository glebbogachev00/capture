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
};

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
