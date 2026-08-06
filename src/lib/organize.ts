/**
 * Organize — a board-wide tidy scan.
 *
 * Where the capture suggestion (related.ts) asks "what does THIS connect to?",
 * Organize asks "what is wrong with the board as it stands?" and proposes
 * concrete consolidation moves, all in one list the user can work through:
 *
 *   - dup_action      the same task captured twice — drop the newer action
 *   - dup_fragment    the same note pasted twice — drop the newer fragment
 *   - fold_action     an action clearly belongs with a thread — fold it in
 *   - merge_threads   two threads are the same subject — merge them
 *   - move_fragment   a note is sitting in the wrong thread — move it
 *   - extract_action  a fragment reads as a doable task — lift it out
 *
 * Purely local and deterministic: no model, no quota, instant, and unit-tested.
 * Every claim reuses the strict matching rules of related.ts — only content
 * words count, generic overlap never proposes anything, and every proposal
 * carries a verifiable reason. Claims carry a confidence: "high" proposals
 * are the strong, concrete ones shown up front; "medium" ones sit behind a
 * "Show more" in the panel, so the scan is alive without being noisy.
 * Nothing is applied here; the hook decides how a proposal becomes a change.
 */

import type { Action, Board, Thread } from "./model";
import {
  bestActionDuplicate,
  bestFragmentDuplicate,
  bestThreadHome,
  contentWords,
  sharedContentWords,
  sharedPhrase,
} from "./related";

export type OrganizeConfidence = "high" | "medium";

export type OrganizeKind =
  | "dup_action"
  | "dup_fragment"
  | "fold_action"
  | "merge_threads"
  | "move_fragment"
  | "extract_action";

export type OrganizeProposal = {
  /** Deterministic — same board always yields the same id, so a dismissal
      can be remembered by id and the same proposal never reappears. */
  id: string;
  kind: OrganizeKind;
  /** high = strong and concrete, shown first; medium = behind "Show more". */
  confidence: OrganizeConfidence;
  /** What the Accept button says: "Drop duplicate", "Fold in", "Merge",
      "Move", "Extract". */
  verb: string;
  /** The item that moves or gets dropped. For fragment kinds this is the
      thread holding the copy — sourceFragId names the fragment itself. */
  sourceId: string;
  sourceName: string;
  /** dup_fragment / move_fragment / extract_action: the thread + fragment. */
  sourceThreadId?: string;
  sourceFragId?: string;
  /** Where it goes, or what stays (for duplicates). */
  targetId: string;
  targetName: string;
  /** Why — always a shared phrase or quoted text the user can verify. */
  reason: string;
  /** Ordering weight within a confidence tier. */
  score: number;
};

/** The panel shows at most this many strong claims, then this many medium
    ones behind "Show more" — a personal board needs the strong claims, not
    the long tail. */
export const HIGH_CAP = 12;
export const MEDIUM_CAP = 8;
export const ORGANIZE_CAP = HIGH_CAP + MEDIUM_CAP;

const NAME = (s: string) => (s.length > 60 ? s.slice(0, 60) + "…" : s);

const threadText = (t: Thread): string =>
  [t.name, t.summary, ...(t.frags || []).map((f) => f.text)]
    .filter(Boolean)
    .join(" ");

/** A thread's text with one fragment left out — used to check whether a
    fragment belongs where it sits, rather than matching its own words. */
const threadTextWithout = (
  board: Board,
  threadId: string,
  fragId?: string
): string => {
  const t = board.threads.find((x) => x.id === threadId);
  if (!t) return "";
  return [t.name, t.summary, ...(t.frags || [])
    .filter((f) => f.id !== fragId)
    .map((f) => f.text)]
    .filter(Boolean)
    .join(" ");
};

const actionText = (a: Action): string =>
  [a.text, a.src].filter(Boolean).join(" ");

const threadTextById = (board: Board, id: string): string => {
  const t = board.threads.find((x) => x.id === id);
  return t ? threadText(t) : "";
};

const phraseWords = (phrase: string) =>
  phrase ? phrase.split(" ").length : 0;

/** How many items across the board contain each content word. A word shared
    by everything means nothing; a word in only a few items is distinctive. */
function wordRarity(board: Board): Map<string, number> {
  const counts = new Map<string, number>();
  const bump = (s: string) => {
    for (const w of new Set(contentWords(s)))
      counts.set(w, (counts.get(w) || 0) + 1);
  };
  for (const a of board.actions) bump(actionText(a));
  for (const t of board.threads) bump(threadText(t));
  return counts;
}

/** Classify a shared-phrase signal into a confidence tier. */
function tierFor(phrase: string): OrganizeConfidence {
  return phraseWords(phrase) >= 3 ? "high" : "medium";
}

/**
 * Scan the whole board for consolidation moves, strongest first.
 *
 * Rules that keep the scan honest:
 *   - A proposal only forms on real overlap — shared content words; generic
 *     overlap never proposes anything.
 *   - A duplicate is always proposed from the NEWER copy, so the original
 *     (with its shelf life, images and notes) is never at risk, and each
 *     pair yields exactly one proposal.
 *   - A faded or done action, or an empty thread, never proposes.
 *   - A fragment gets at most one proposal: a duplicate claim beats a move,
 *     and a move beats an action extraction.
 *   - A dismissed proposal (by id) never reappears.
 */
export function scanBoard(
  board: Board,
  dismissed: Iterable<string> = []
): OrganizeProposal[] {
  const dropped = new Set(dismissed);
  const counts = wordRarity(board);
  const itemCount =
    board.actions.length + board.threads.length + board.intentions.length;
  const maxShare = Math.max(2, Math.floor(itemCount / 4));
  const out: OrganizeProposal[] = [];
  const dupClaimed = new Set<string>();
  const fragClaimed = new Set<string>();

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
    const phrase = sharedPhrase(actionText(a), actionText(target));
    dupClaimed.add(a.id);
    out.push({
      id: `dup_action:${a.id}:${dup.id}`,
      kind: "dup_action",
      confidence: tierFor(phrase),
      verb: "Drop duplicate",
      sourceId: a.id,
      sourceName: NAME(a.text),
      targetId: dup.id,
      targetName: NAME(dup.name),
      reason: `both mention "${phrase}"`,
      score: 100 + phraseWords(phrase) * 10,
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
      const phrase = sharedPhrase(f.text, targetFrag.text);
      const crossThread = dup.threadId !== t.id;
      fragClaimed.add(f.id);
      out.push({
        id: `dup_fragment:${f.id}:${dup.fragId}`,
        kind: "dup_fragment",
        confidence: tierFor(phrase),
        verb: "Drop duplicate",
        sourceId: t.id,
        sourceName: NAME(f.text),
        sourceThreadId: t.id,
        sourceFragId: f.id,
        targetId: dup.threadId,
        targetName:
          NAME(dup.name) +
          (crossThread ? ` (in "${dup.threadName}")` : ""),
        reason: `both mention "${phrase}"`,
        score: 100 + phraseWords(phrase) * 10,
      });
    }
  }

  /* Fold an action into the thread it clearly belongs with. */
  for (const a of board.actions) {
    if (a.faded || a.done || dupClaimed.has(a.id)) continue;
    const hit = bestThreadHome(board, actionText(a), a.id);
    if (!hit) continue;
    const phrase = sharedPhrase(actionText(a), threadTextById(board, hit.id));
    out.push({
      id: `fold_action:${a.id}:${hit.id}`,
      kind: "fold_action",
      confidence: tierFor(phrase),
      verb: "Fold in",
      sourceId: a.id,
      sourceName: NAME(a.text),
      targetId: hit.id,
      targetName: NAME(hit.name),
      reason: `belongs with "${phrase}"`,
      score: 90 + phraseWords(phrase) * 10,
    });
  }

  /* Merge two threads that are the same subject. The bar is deliberately
     lower than v1's single three-word-phrase test — real threads about the
     same thing rarely share a long verbatim run — so it combines signals:
       - a shared content-word phrase (3 words = high, 2 = medium)
       - a run of shared RARE words, the words only a few items use
         (3+ shared = medium — "both keep returning to X, Y, Z")
     The bigger thread is kept (more fragments = more history); a tie goes
     to the older one by its first fragment, so the direction is
     deterministic. */
  for (let i = 0; i < board.threads.length; i++) {
    for (let j = i + 1; j < board.threads.length; j++) {
      const a = board.threads[i];
      const b = board.threads[j];
      if (!(a.frags || []).length || !(b.frags || []).length) continue;
      const phrase = sharedPhrase(threadText(a), threadText(b));
      const words = phraseWords(phrase);
      const rare = sharedContentWords(threadText(a), threadText(b)).filter(
        (w) => (counts.get(w) || 99) <= maxShare
      );
      let confidence: OrganizeConfidence | null = null;
      let reason = "";
      if (words >= 3) {
        confidence = "high";
        reason = `both are about "${phrase}"`;
      } else if (words === 2) {
        confidence = "medium";
        reason = `both mention "${phrase}"`;
      } else if (maxShare > 2 && rare.length >= 3) {
        /* Rare words only mean rare once the board is big enough that most
           shared words are NOT rare — at the maxShare floor of 2, any three
           shared content words would qualify, which is a noise claim. */
        confidence = "medium";
        reason = `both keep returning to ${rare.slice(0, 3).join(", ")}`;
      }
      if (!confidence) continue;
      const aBigger = (a.frags?.length || 0) - (b.frags?.length || 0);
      const aOlder = (a.frags?.[0]?.at ?? 0) <= (b.frags?.[0]?.at ?? 0);
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
        confidence,
        verb: "Merge",
        sourceId: merge.id,
        sourceName: NAME(merge.name),
        targetId: keep.id,
        targetName: NAME(keep.name),
        reason,
        score:
          (confidence === "high" ? 200 : 100) +
          words * 10 +
          rare.length * 5,
      });
    }
  }

  /* Move a fragment to the thread it clearly belongs with. Strict in both
     directions: the fragment must phrase-match another thread AND must not
     phrase-match its own thread's other content — a shared-topic fragment
     stays where it is; a genuinely misplaced note moves. */
  for (const t of board.threads) {
    /* A single-fragment thread is not a misplaced note, it is a thread that
       belongs elsewhere — that is a merge's claim, not a move's. Skipping
       it also stops the two directions from proposing each other. */
    if ((t.frags || []).length < 2) continue;
    for (const f of t.frags || []) {
      if (fragClaimed.has(f.id)) continue;
      const home = bestThreadHome(board, f.text, t.id);
      if (!home) continue;
      if (sharedPhrase(f.text, threadTextWithout(board, t.id, f.id))) continue;
      const phrase = sharedPhrase(f.text, threadTextById(board, home.id));
      fragClaimed.add(f.id);
      out.push({
        id: `move_fragment:${f.id}:${home.id}`,
        kind: "move_fragment",
        confidence: tierFor(phrase),
        verb: "Move",
        sourceId: t.id,
        sourceName: NAME(f.text),
        sourceThreadId: t.id,
        sourceFragId: f.id,
        targetId: home.id,
        targetName: NAME(home.name),
        reason: `belongs with "${phrase}" in "${home.name}"`,
        score: 80 + phraseWords(phrase) * 10,
      });
    }
  }

  /* Extract a doable task out of a fragment. Deliberately narrow — only
     fragments that OPEN with a task marker, short enough to be one action,
     and not already claimed by a stronger proposal. The extraction itself
     runs through the model's action engine when accepted. */
  const TASK_RE =
    /^(i (need|should|have|must|really|just) to|remember to|don'?t forget|to[- ]do|make sure (to|i)|go (and|ahead)|must|should|please)\b/i;
  /* Frame phrases that are not tasks: "I have to admit…", "Please note…". */
  const FRAME_RE =
    /^(i have to (say|admit|confess)|please (note|see|be)|i just (want|wanted) to say)\b/i;
  for (const t of board.threads) {
    for (const f of t.frags || []) {
      if (fragClaimed.has(f.id)) continue;
      if (f.text.length > 220) continue;
      if (!TASK_RE.test(f.text.trim())) continue;
      if (FRAME_RE.test(f.text.trim())) continue;
      fragClaimed.add(f.id);
      out.push({
        id: `extract_action:${f.id}`,
        kind: "extract_action",
        confidence: "medium",
        verb: "Extract",
        sourceId: t.id,
        sourceName: NAME(f.text),
        sourceThreadId: t.id,
        sourceFragId: f.id,
        targetId: t.id,
        targetName: "an action",
        reason: `reads as a task: "${f.text.slice(0, 60)}"`,
        score: 70,
      });
    }
  }

  const live = out.filter((p) => !dropped.has(p.id));
  const high = live
    .filter((p) => p.confidence === "high")
    .sort((x, y) => y.score - x.score)
    .slice(0, HIGH_CAP);
  const medium = live
    .filter((p) => p.confidence === "medium")
    .sort((x, y) => y.score - x.score)
    .slice(0, MEDIUM_CAP);
  return [...high, ...medium];
}
