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
  /** An ISO deadline the conversation named, or null. */
  due?: string | null;
  /** Which model tier settled it — recorded in the capture ledger. */
  via?: string;
};

/**
 * Reconcile a settled result before it is shown or filed.
 *
 * The settler occasionally calls a long, exploratory conversation an "action"
 * yet lists nothing to do. Filing that meant the whole distilled conversation
 * was dumped into a single action's text — the "it saved my conversation as
 * one giant to-do" bug. An action with no concrete item is a contradiction:
 * the thing to do is what makes it an action. So an action that names no task
 * is reclassified as a thread, where the full wording is kept as a readable
 * fragment. Intentions and real actions pass through untouched.
 *
 * Pure and deterministic so it can guard both the route and the client.
 */
export function resolveSettled<
  T extends { kind: "action" | "thread" | "intention"; actions?: string[] },
>(settled: T): T {
  const items = (settled.actions ?? [])
    .map((a) => a.trim())
    .filter(Boolean);
  if (settled.kind === "action" && items.length === 0) {
    return { ...settled, kind: "thread", actions: [] };
  }
  return { ...settled, actions: items };
}

/* The two ways a clarifier reply can end. [ready] means the conversation
   holds something to file — it lights the Distill button. [nothing] means
   the turn was pure small talk with nothing worth filing — the app wipes
   the session instead of lighting the button. */
export const READY_MARKER = "[ready]";
export const NOTHING_MARKER = "[nothing]";

/**
 * Which end-marker appears first in a streamed chunk, if any.
 *
 * The chat route streams the clarifier's reply, and a marker can be split
 * across chunk boundaries, so the client asks this on every chunk (with the
 * held suffix prepended) rather than once at the end. Returns the earliest
 * marker and its index; null when neither is present. Purely structural so
 * it is deterministic and unit-testable.
 */
export function findMarker(
  raw: string
): { kind: "ready" | "nothing"; at: number } | null {
  let best: { kind: "ready" | "nothing"; at: number } | null = null;
  for (const [marker, kind] of [
    [READY_MARKER, "ready"],
    [NOTHING_MARKER, "nothing"],
  ] as const) {
    const at = raw.indexOf(marker);
    if (at !== -1 && (!best || at < best.at)) best = { kind, at };
  }
  return best;
}

/**
 * Longest suffix of `raw` that could be the start of an end-marker.
 *
 * The streaming client holds those trailing characters back for the next
 * chunk so a marker split at a boundary is still caught, while ordinary
 * text streams with no lag. Returns 0 when nothing could begin a marker.
 */
export function markerHold(raw: string): number {
  const maxPrefix = Math.max(READY_MARKER.length, NOTHING_MARKER.length) - 1;
  for (let n = Math.min(raw.length, maxPrefix); n >= 1; n--) {
    const tail = raw.slice(-n);
    if (READY_MARKER.startsWith(tail) || NOTHING_MARKER.startsWith(tail)) {
      return n;
    }
  }
  return 0;
}

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
