import type { Board, Thread } from "./model";

/**
 * Accepting a thread summary that took its time — gate 6 of the done
 * contract.
 *
 * A summary request leaves carrying the thread as it was. While the model
 * writes, the person may capture again onto the same thread, rename it, or
 * merge it away. The reply then describes a thread that no longer exists
 * in that form — and it used to land anyway, overwriting "where this
 * stands" and the next step with an account of two layers ago. Nothing on
 * screen said so, and the sorter went on routing against the stale
 * description.
 *
 * The rule: a summary may only land on the exact content it summarized.
 * The caller fingerprints the thread when the request LEAVES; the reply is
 * accepted only if the fingerprint still matches. A rejected reply costs
 * nothing — whatever changed the thread scheduled its own, newer summary,
 * which supersedes this one.
 */

/** What the summary is ABOUT: the name and each fragment's identity and
    time. Any change to these makes an in-flight summary stale. */
export function threadFingerprint(t: Thread): string {
  return (
    t.name +
    "|" +
    (t.frags ?? []).map((f) => `${f.id}:${f.at ?? 0}`).join(",")
  );
}

export function acceptSummary(
  board: Board,
  threadId: string,
  sentFingerprint: string,
  out: { summary: string; next?: string | null; belongs?: string | null }
): Board | null {
  const t = board.threads.find((x) => x.id === threadId);
  if (!t) return null;
  if (threadFingerprint(t) !== sentFingerprint) return null;

  return {
    ...board,
    threads: board.threads.map((x) =>
      x.id === threadId
        ? {
            ...x,
            summary: out.summary,
            next: out.next ?? null,
            ...(out.belongs ? { belongs: out.belongs } : {}),
          }
        : x
    ),
  };
}
