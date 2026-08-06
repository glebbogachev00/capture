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
