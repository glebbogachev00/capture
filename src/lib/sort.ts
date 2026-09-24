/**
 * Reconciling what the sort model returned before it is filed.
 *
 * The model occasionally returns a `kind` that its own fields contradict — a
 * "both" with nothing to do, or a "both" with no thinking to keep. Filing that
 * verbatim would either lose content or create an empty half. This collapses
 * such a result to the single kind its fields actually support, mirroring
 * resolveSettled for the Distill path.
 *
 * Pure and deterministic so it can guard both the route and the client.
 */

export type SortKind = "action" | "thread" | "intention" | "both";

/**
 * Detect an explicit rule the person is setting beyond a single task.
 *
 * Models reliably understand the sentence but often file it as a Thread
 * because the general prompt deliberately prefers Threads when uncertain.
 * Requiring both a declaration and durable language keeps one-off decisions
 * ("I decided to buy milk tomorrow") out of Intentions.
 */
export function explicitStandingDecision(raw: string): boolean {
  const text = raw.toLowerCase().replaceAll("’", "'");
  const declared =
    /\b(?:i(?:'ve| have) decided|i commit|i(?:'m| am) committed|my rule is|from now on)\b/.test(
      text
    );
  const durable =
    /\b(?:always|never|every|each time|whenever|from now on|no longer)\b/.test(text);
  return declared && durable;
}

export function enforceStandingDecision<
  T extends {
    kind: SortKind;
    actions?: string[];
    threadId?: string | null;
    threadName?: string | null;
  },
>(raw: string, out: T): T {
  if (
    !explicitStandingDecision(raw) ||
    out.kind === "intention" ||
    out.kind === "both" ||
    (out.kind === "thread" && (out.actions ?? []).some((action) => action.trim()))
  ) {
    return out;
  }
  return {
    ...out,
    kind: "intention",
    actions: [],
    threadId: null,
    threadName: null,
  };
}

function standaloneShare(text: string): string {
  return text.replace(/^\s*(?:Separately|On a separate note|On another note|Also),\s+(?=\S)/i, "");
}

/** Only remove shares fully accounted for by extracted tasks. No fuzzy semantic
 * matching: an action plus deliberation must keep its thinking destination. */
export function thinkingShares<T extends { text: string }>(
  pieces: T[] | null | undefined, actions: string[] | undefined
): T[] {
  const key = (text: string) => standaloneShare(text).trim().toLowerCase()
    .replace(/^[-*]\s+/, "").replace(/[.!]+$/, "").replace(/\s+/g, " ");
  const tasks = new Set((actions ?? []).map(key).filter(Boolean));
  return (pieces ?? []).filter(piece => {
    if (!piece?.text?.trim()) return false;
    if (tasks.has(key(piece.text))) return false;
    const lines = piece.text.trim().split(/\n+|[.!]\s+/).filter(line => key(line));
    return !lines.length || !lines.every(line => tasks.has(key(line)));
  });
}

export function reconcileSorted<
  T extends {
    kind: SortKind;
    due?: string | null;
    actions?: string[];
    threadId?: string | null;
    threadName?: string | null;
    primaryText?: string | null;
    also?: { text: string; threadId?: string | null; threadName?: string | null }[] | null;
  },
>(out: T): T {
  if (out.also) out = { ...out, also: thinkingShares(out.also, out.actions) };
  if (
    (out.kind === "thread" || out.kind === "both") &&
    (out.threadId || out.threadName?.trim()) &&
    out.also?.some((share) => share.text.trim() && (share.threadId || share.threadName?.trim()))
  ) {
    out = {
      ...out,
      primaryText: out.primaryText == null ? out.primaryText : standaloneShare(out.primaryText),
      also: out.also.map((share) => ({ ...share, text: standaloneShare(share.text) })),
    };
  }
  const actions = (out.actions ?? []).map((a) => a.trim()).filter(Boolean);
  // The legacy scalar has no action selector. Never copy one task's deadline
  // onto siblings; their timing remains in action text and the whole Record.
  if (actions.length > 1 && out.due) out = { ...out, due: null };

  if (out.kind === "both") {
    const hasThread = Boolean(out.threadId || out.threadName?.trim());
    // No task to close: it is only thinking → a thread.
    if (!actions.length) {
      return { ...out, kind: "thread", actions: [] };
    }
    // No thread to keep: it is only a task → an action.
    if (!hasThread) {
      return { ...out, kind: "action", actions, threadId: null, threadName: null };
    }
    return { ...out, actions };
  }

  return { ...out, actions };
}
