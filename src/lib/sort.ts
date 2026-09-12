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

export function reconcileSorted<
  T extends {
    kind: SortKind;
    actions?: string[];
    threadId?: string | null;
    threadName?: string | null;
  },
>(out: T): T {
  const actions = (out.actions ?? []).map((a) => a.trim()).filter(Boolean);

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
