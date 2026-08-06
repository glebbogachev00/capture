/**
 * Organize — a board-wide tidy scan.
 *
 * Where the capture suggestion (related.ts) asks "what does THIS connect to?",
 * Organize asks "what is wrong with the board as it stands?" and proposes
 * concrete consolidation moves, all in one list the user can work through:
 *
 *   - dup_action     the same task captured twice — drop the newer action
 *   - dup_fragment   the same note pasted twice — drop the newer fragment
 *   - fold_action    an action clearly belongs with a thread — fold it in
 *   - merge_threads  two threads are the same subject — merge them
 *
 * Purely local and deterministic: no model, no quota, instant, and unit-tested.
 * Every claim reuses the same strict bar as the capture suggestions — only a
 * shared phrase of content words (never a lone shared word) earns a proposal,
 * and every proposal carries the shared phrase as a verifiable reason. Nothing
 * is applied here; the hook decides how a proposal becomes a change.
 */

import type { Action, Board, Thread } from "./model";
import {
  bestActionDuplicate,
  bestFragmentDuplicate,
  bestThreadHome,
  sharedPhrase,
} from "./related";

export type OrganizeKind =
  | "dup_action"
  | "dup_fragment"
  | "fold_action"
  | "merge_threads";

export type OrganizeProposal = {
  /** Deterministic — same board always yields the same id, so a dismissal
      can be remembered by id and the same proposal never reappears. */
  id: string;
  kind: OrganizeKind;
  /** What the Accept button says: "Drop duplicate", "Fold in", "Merge". */
  verb: string;
  /** The item that moves or gets dropped. For dup_fragment this is the
      thread holding the copy — sourceFragId names the fragment itself. */
  sourceId: string;
  sourceName: string;
  /** dup_fragment only: the thread holding the fragment to drop. */
  sourceThreadId?: string;
  /** dup_fragment only: the fragment to drop. */
  sourceFragId?: string;
  /** Where it goes, or what stays (for duplicates). */
  targetId: string;
  targetName: string;
  /** Why — always a shared phrase the user can verify. */
  reason: string;
  /** Ordering weight: dup claims first, then folds, then merges. */
  score: number;
};

/** The panel shows at most this many proposals; a personal board needs the
    strong claims, not the long tail. */
export const ORGANIZE_CAP = 12;

const NAME = (s: string) => (s.length > 60 ? s.slice(0, 60) + "…" : s);

const threadText = (t: Thread): string =>
  [t.name, t.summary, ...(t.frags || []).map((f) => f.text)]
    .filter(Boolean)
    .join(" ");

const actionText = (a: Action): string =>
  [a.text, a.src].filter(Boolean).join(" ");

const phraseWords = (phrase: string | undefined) =>
  phrase ? phrase.split(" ").length : 0;

/**
 * Scan the whole board for consolidation moves, strongest first.
 *
 * Rules that keep the scan honest:
 *   - A proposal only forms on a shared phrase — the same strict bar the
 *     capture suggestions use; generic overlap never proposes anything.
 *   - A duplicate is always proposed from the NEWER copy, so the original
 *     (with its shelf life, images and notes) is never at risk, and each
 *     pair yields exactly one proposal.
 *   - A faded action, a done action, or an empty thread never proposes.
 *   - An action already claimed by a duplicate proposal is not also offered
 *     a fold — the stronger claim wins, one proposal per item.
 *   - A dismissed proposal (by id) never reappears.
 */
export function scanBoard(
  board: Board,
  dismissed: Iterable<string> = []
): OrganizeProposal[] {
  const dropped = new Set(dismissed);
  const out: OrganizeProposal[] = [];
  const dupClaimed = new Set<string>();

  /* Duplicate actions — same task twice. The newer action is the copy. */
  for (const a of board.actions) {
    if (a.faded || a.done) continue;
    const dup = bestActionDuplicate(board, actionText(a), a.id);
    if (!dup) continue;
    const target = board.actions.find((x) => x.id === dup.id);
    if (!target || target.faded) continue;
    /* Only the newer of the pair proposes; a re-capture of a task that is
       already fading is a refresh, not a duplicate. */
    if (a.at <= (target.at || 0)) continue;
    dupClaimed.add(a.id);
    out.push({
      id: `dup_action:${a.id}:${dup.id}`,
      kind: "dup_action",
      verb: "Drop duplicate",
      sourceId: a.id,
      sourceName: NAME(a.text),
      targetId: dup.id,
      targetName: NAME(dup.name),
      reason: dup.reason,
      score: 1000 + phraseWords(dup.reason),
    });
  }

  /* Duplicate fragments — the same note pasted twice, in one thread or
     across two. The newer fragment is the copy. */
  for (const t of board.threads) {
    for (const f of t.frags || []) {
      const dup = bestFragmentDuplicate(board, f.text, f.id);
      if (!dup) continue;
      const targetFrag = board.threads
        .find((x) => x.id === dup.threadId)
        ?.frags.find((x) => x.id === dup.fragId);
      if (!targetFrag || f.at <= (targetFrag.at || 0)) continue;
      const crossThread = dup.threadId !== t.id;
      out.push({
        id: `dup_fragment:${f.id}:${dup.fragId}`,
        kind: "dup_fragment",
        verb: "Drop duplicate",
        sourceId: t.id,
        sourceName: NAME(f.text),
        sourceThreadId: t.id,
        sourceFragId: f.id,
        targetId: dup.threadId,
        targetName:
          NAME(dup.name) +
          (crossThread ? ` (in "${dup.threadName}")` : ""),
        reason: dup.reason,
        score: 1000 + phraseWords(dup.reason),
      });
    }
  }

  /* Fold an action into the thread it clearly belongs with. */
  for (const a of board.actions) {
    if (a.faded || a.done || dupClaimed.has(a.id)) continue;
    const hit = bestThreadHome(board, actionText(a), a.id);
    if (!hit) continue;
    out.push({
      id: `fold_action:${a.id}:${hit.id}`,
      kind: "fold_action",
      verb: "Fold in",
      sourceId: a.id,
      sourceName: NAME(a.text),
      targetId: hit.id,
      targetName: NAME(hit.name),
      reason: hit.reason,
      score: 800 + phraseWords(hit.reason),
    });
  }

  /* Merge two threads that are the same subject. Strongest bar of all: a
     shared run of THREE content words — the phrase two threads about the
     same thing share, which two threads that merely touch never reach.
     The bigger thread is kept (more fragments = more history); ties go to
     the older one, so the merge direction is deterministic. */
  for (let i = 0; i < board.threads.length; i++) {
    for (let j = i + 1; j < board.threads.length; j++) {
      const a = board.threads[i];
      const b = board.threads[j];
      if (!(a.frags || []).length || !(b.frags || []).length) continue;
      const phrase = sharedPhrase(threadText(a), threadText(b));
      const words = phraseWords(phrase);
      if (words < 3) continue;
      /* The bigger thread is kept (more fragments = more history); a tie
         goes to the older one by its first fragment, so the merge
         direction is fully deterministic. */
      const aBigger = (a.frags?.length || 0) - (b.frags?.length || 0);
      const aOlder =
        (a.frags?.[0]?.at ?? 0) <= (b.frags?.[0]?.at ?? 0);
      const [keep, merge] =
        aBigger !== 0
          ? aBigger > 0
            ? [a, b]
            : [b, a]
          : aOlder
            ? [a, b]
            : [b, a];
      out.push({
        id: `merge_threads:${merge.id}:${keep.id}`,
        kind: "merge_threads",
        verb: "Merge",
        sourceId: merge.id,
        sourceName: NAME(merge.name),
        targetId: keep.id,
        targetName: NAME(keep.name),
        reason: `both are about "${phrase}"`,
        score: 600 + words,
      });
    }
  }

  return out
    .filter((p) => !dropped.has(p.id))
    .sort((x, y) => y.score - x.score)
    .slice(0, ORGANIZE_CAP);
}
