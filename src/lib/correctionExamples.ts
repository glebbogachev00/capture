import type { CorrectionEntry } from "./ledger";

export const CORRECTION_EXAMPLES_CAP = 5;
const CORRECTION_THREAD_NAME_MAX = 100;

export type CorrectionExample = {
  key: string;
  text: string;
  capture: string;
  kind: "action" | "thread" | "intention";
  threadId?: string;
  threadName?: string;
  lastAt: number;
};

type ThreadChoice = { id: string; name: string };

/**
 * Turn explicit routing corrections into bounded model context.
 *
 * No words are extracted or compared. The whole bounded capture and the
 * explicit corrected outcome travel together as one example; the model alone
 * decides whether a future capture is semantically related.
 */
export function deriveCorrectionExamples(
  corrections: CorrectionEntry[],
  threads: ThreadChoice[],
  disabledKeys: string[] = [],
): CorrectionExample[] {
  const disabled = new Set(disabledKeys);
  const existingThreads = new Map(threads.map((thread) => [thread.id, thread.name]));

  const visible = corrections
    .filter((correction) => correction.accepted && correction.routing)
    .map((correction): CorrectionExample | null => {
      const capture = correction.context.trim().slice(0, 160);
      if (!capture || !correction.routing) return null;
      const key = `correction:${correction.id}`;
      const { kind, threadId } = correction.routing;
      if (kind === "thread" && threadId && !existingThreads.has(threadId)) return null;
      const resolvedThreadName = threadId
        ? existingThreads.get(threadId) ?? correction.routing.threadName
        : correction.routing.threadName;
      const threadName = resolvedThreadName?.trim().slice(0, CORRECTION_THREAD_NAME_MAX);
      const destination = kind === "thread" && threadName
        ? threadName
        : kind[0].toUpperCase() + kind.slice(1);

      return {
        key,
        text: `“${capture}” → ${destination}`,
        capture,
        kind,
        ...(threadId ? { threadId } : {}),
        ...(threadName ? { threadName } : {}),
        lastAt: correction.at,
      };
    })
    .filter((example): example is CorrectionExample => example !== null)
    .sort((a, b) => b.lastAt - a.lastAt || a.key.localeCompare(b.key))
    .slice(0, CORRECTION_EXAMPLES_CAP);

  // The visible five are a fixed window. Disabling one must not silently make
  // an older correction that Settings did not show start influencing Sort.
  return visible.filter((example) => !disabled.has(example.key));
}
