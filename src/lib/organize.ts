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
 *   - move_fragment   a note is sitting in the wrong thread — move it
 *   - extract_action  a fragment reads as a doable task — lift it out
 *   - merge_fragments the same idea worded differently in two notes — move
 *                     one into the other's thread (proposed by the model)
 *   - let_go          an action still being carried past its moment — fade it
 *
 * The product rule: this scan only ever reduces clutter — it never
 * restructures for its own sake, and it never merges whole threads into one
 * another (that is the one change the user explicitly rejected). A note may
 * move; a thread never does.
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
  bestFragmentOverlap,
  bestThreadHome,
  contentWords,
  phraseAsWritten,
  sharedPhrase,
} from "./related";

export type OrganizeConfidence = "high" | "medium";

export type OrganizeKind =
  | "dup_action"
  | "dup_fragment"
  | "fold_action"
  | "move_fragment"
  | "extract_action"
  | "merge_fragments"
  /** Still being carried, past its moment — the "get light" claim. */
  | "let_go";

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
  /** dup_fragment / move_fragment / extract_action / merge_fragments: the
      thread + fragment. */
  sourceThreadId?: string;
  sourceFragId?: string;
  /** Where it goes, or what stays (for duplicates). */
  targetId: string;
  targetName: string;
  /** Why — always a shared phrase or quoted text the user can verify. */
  reason: string;
  /** Ordering weight within a confidence tier. */
  score: number;
  /** Where the claim came from: the free instant word-match scan, or the
      model's semantic review (which can see the same idea in different
      words). The review screen shows a chip per row. */
  origin: "ai" | "local";
};

/** The panel shows at most this many strong claims, then this many medium
    ones behind "Show more" — a personal board needs the strong claims, not
    the long tail. */
export const HIGH_CAP = 12;

const DAY_MS = 24 * 60 * 60 * 1000;
/** A dated action is only overdue once it has outlived the grace its own
    deadline bought it — the same day the shelf life already allows. */
const AFTER_DUE = DAY_MS;
/** How long a "keep" action may sit before the scan asks about it. Six
    weeks: long enough that a real commitment is not nagged at, short enough
    that a dead one is not carried for a year. */
const LONG_CARRY = 45 * DAY_MS;
export const MEDIUM_CAP = 8;

/** Normalised note text — trimmed, lowercased, whitespace collapsed. The
    unit of note-equality for the fold-back guard. */
const normNote = (s: string): string =>
  s.toLowerCase().replace(/\s+/g, " ").trim();

/** Whether any of a thread's fragments reads as the same note as any of the
    given texts — the fold-back guard. An action extracted from a thread
    folds right back into the very note it came from; folding would only
    copy it again, so both the scan and the fold itself must refuse it. */
export function threadHoldsNote(
  frags: { text?: string }[] | undefined,
  ...texts: (string | undefined)[]
): boolean {
  const wants = texts
    .filter((s): s is string => !!s)
    .map(normNote)
    .filter((s) => s.length > 0);
  if (!wants.length) return false;
  return (frags || []).some((f) => {
    const have = normNote(f.text || "");
    return have.length > 0 && wants.includes(have);
  });
}

/** A card named short enough to decide on.
    Sixty characters wrapped to a second line and cut mid-word, which pushed
    the thread name — the part you are actually deciding about — out of the
    first glance. Break on a word, and flatten the newlines a pasted note
    carries so a list does not unravel across the row. */
export const NAME = (s: string) => {
  const flat = s.replace(/\s+/g, " ").trim();
  if (flat.length <= 46) return flat;
  const cut = flat.slice(0, 46);
  const space = cut.lastIndexOf(" ");
  const kept = space > 24 ? cut.slice(0, space) : cut;
  /* Drop a trailing orphan ("…drifting after a …" reads as a stumble). */
  return kept.replace(/\s+\S{1,2}$/, "") + "…";
};

/** A thread's OWN words: what it is called and what was actually put in it.
    Deliberately excludes `summary`, which is Capture's generated prose about
    the thread — matching against it lets the app cite itself, and summaries
    are dense with connective vocabulary ("step-by-step", "records three"),
    so they manufacture overlap that the thread's real content does not have. */
const threadOwnText = (t: Thread): string =>
  [t.name, ...(t.frags || []).map((f) => f.text)].filter(Boolean).join(" ");

const threadOwnTextById = (board: Board, id: string): string => {
  const t = board.threads.find((x) => x.id === id);
  return t ? threadOwnText(t) : "";
};

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

/**
 * An action is what Capture made of it, not the breath it arrived in.
 *
 * `src` is the raw utterance, and one utterance routinely carries several
 * subjects — "heat map seems off, fix this bug" and, four lines later, an
 * aside about gamifying capture. Matching on it made two unrelated actions
 * duplicates of each other because both transcripts mentioned the aside,
 * and the row then quoted words that appear nowhere on the row: the card
 * says "Fix heat map bug", the reason said both say "find ways gamify".
 *
 * Evidence has to be visible where the claim points. The grouping lens
 * already reads `a.text` alone, which is why it said no two actions shared
 * a subject while Organize called those same two duplicates.
 */
const actionText = (a: Action): string => a.text;

const phraseWords = (phrase: string) =>
  phrase ? phrase.split(" ").length : 0;

/**
 * A shared word only means something if it is rare.
 *
 * Filing claims used to fire on any two-word overlap, which put a note
 * about a duplication bug into a thread of bank account numbers because
 * both contained "three" and "items". Length is the wrong test: "espresso
 * machine" is two words and decisive, "three items" is two words and
 * meaningless. What separates them is how common they are on this board.
 *
 * A word carried by at most two threads is one that lives essentially here
 * and there — which is what "this belongs over there" has to mean. Past
 * that it is floating vocabulary, and the biggest threads catch everything.
 *
 * Semantic filing — same meaning, different words — stays the model pass's
 * job. This pass only claims what it can point at.
 */
const RARE_IN_AT_MOST = 2;

/** How many threads use each content word at all. */
function threadFrequency(board: Board): Map<string, number> {
  const freq = new Map<string, number>();
  for (const t of board.threads)
    for (const w of new Set(contentWords(threadOwnText(t))))
      freq.set(w, (freq.get(w) || 0) + 1);
  return freq;
}

/** Does this overlap rest on anything the board does not say everywhere? */
function distinctive(phrase: string, freq: Map<string, number>): boolean {
  if (!phrase) return false;
  return phrase
    .split(" ")
    .some((w) => (freq.get(w) ?? 0) <= RARE_IN_AT_MOST);
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
  dismissed: Iterable<string> = [],
  now: number = Date.now()
): OrganizeProposal[] {
  const dropped = new Set(dismissed);
  const freq = threadFrequency(board);
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
      reason: `both say "${phraseAsWritten(phrase, a.text)}"`,
      score: 100 + phraseWords(phrase) * 10,
      origin: "local",
    });
  }

  /* Overlapping fragments. Two notes that share real language are either the
     same note pasted twice — drop the copy — or two notes about one subject,
     which is NOT a reason to delete anything. The second case used to arrive
     here as a duplicate and put a Remove button under a note the user had
     only written once; it now proposes a merge at most, and only when the
     notes are sitting in different threads. The newer fragment is the one
     that moves or goes. */
  for (const t of board.threads) {
    for (const f of t.frags || []) {
      const dup = bestFragmentOverlap(board, f.text, f.id);
      if (!dup) continue;
      const targetFrag = board.threads
        .find((x) => x.id === dup.threadId)
        ?.frags.find((x) => x.id === dup.fragId);
      if (!targetFrag || f.at <= (targetFrag.at || 0)) continue;
      const phrase = sharedPhrase(f.text, targetFrag.text);
      const crossThread = dup.threadId !== t.id;
      if (!dup.duplicate) {
        /* Overlap, not a copy. Two such notes already in one thread are
           already together — say nothing. Across threads they belong side
           by side: propose the merge, which MOVES the note. Never high
           confidence; this is a judgement call, so it sits behind "Show
           more" and stays out of Approve all's strong tier. */
        if (!crossThread) continue;
        if (sharedPhrase(f.text, threadTextWithout(board, t.id, f.id))) continue;
        fragClaimed.add(f.id);
        out.push({
          id: `merge_fragments:${f.id}:${dup.fragId}`,
          kind: "merge_fragments",
          confidence: "medium",
          verb: "Merge",
          sourceId: t.id,
          sourceName: NAME(f.text),
          sourceThreadId: t.id,
          sourceFragId: f.id,
          targetId: dup.threadId,
          targetName: NAME(dup.threadName),
          reason: `a note there already says "${phraseAsWritten(phrase, f.text)}"`,
          score: 85,
          origin: "local",
        });
        continue;
      }
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
        reason: `both say "${phraseAsWritten(phrase, f.text)}"`,
        score: 100 + phraseWords(phrase) * 10,
        origin: "local",
      });
    }
  }

  /* Fold an action into the thread it clearly belongs with. */
  for (const a of board.actions) {
    if (a.faded || a.done || dupClaimed.has(a.id)) continue;
    const hit = bestThreadHome(board, actionText(a), a.id);
    if (!hit) continue;
    /* A fold-back is never a fold: extraction leaves the note in place, so
       an extracted action phrase-matches the very fragment it came from —
       folding it in would copy the note a second time. Skip it entirely. */
    const target = board.threads.find((x) => x.id === hit.id);
    if (!target || threadHoldsNote(target.frags, a.text, a.src)) continue;
    const phrase = sharedPhrase(actionText(a), threadOwnTextById(board, hit.id));
    if (!distinctive(phrase, freq)) continue;
    out.push({
      id: `fold_action:${a.id}:${hit.id}`,
      kind: "fold_action",
      confidence: tierFor(phrase),
      verb: "Fold in",
      sourceId: a.id,
      sourceName: NAME(a.text),
      targetId: hit.id,
      targetName: NAME(hit.name),
      /* Quote the THREAD, not the action. The claim is about what is
         already over there, so the evidence has to come from over there —
         quoting the action's own wording made a two-word overlap read as
         a sentence the thread had never said. */
      reason: `that thread already says "${phraseAsWritten(phrase, threadOwnTextById(board, hit.id))}"`,
      score: 90 + phraseWords(phrase) * 10,
      origin: "local",
    });
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
      const phrase = sharedPhrase(f.text, threadOwnTextById(board, home.id));
      if (!distinctive(phrase, freq)) continue;
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
        reason: `that thread already says "${phraseAsWritten(phrase, threadOwnTextById(board, home.id))}"`,
        score: 80 + phraseWords(phrase) * 10,
        origin: "local",
      });
    }
  }

  /* ------------------------------ get light ------------------------------
     A different question from the rest of this scan. Everything above asks
     "what is messy?"; this asks "what is still pulling at you?".

     It only ever looks at actions the board will NEVER clear by itself.
     Everything with a shelf life fades on its own — that is the whole
     design — so the only things that can pile up indefinitely are the ones
     the app promised to keep, plus anything whose stated deadline has come
     and gone. Those are the open loops, and they are invisible precisely
     because nothing is going to remove them.

     Accepting does NOT delete. It fades the action: it moves to Faded,
     recoverable for two weeks, then goes. Letting go, in the app's own
     vocabulary, and reversible for a fortnight — because "get light" must
     never be a thing you regret having tapped. */
  for (const a of board.actions) {
    if (a.faded || a.done) continue;

    /* Its own stated deadline has passed. The strongest case: the capture
       named the day itself, so nothing here is inferred. */
    const overdue = !!a.due && a.due < now - AFTER_DUE;
    /* Kept, and carried a long time. "keep" means the app will never fade
       it, so this is the only pile that grows without limit. */
    const carried =
      a.shelf === "keep" && !a.due && now - (a.at || 0) > LONG_CARRY;
    if (!overdue && !carried) continue;

    const days = Math.floor((now - (overdue ? a.due! : a.at || now)) / DAY_MS);
    out.push({
      id: `let_go:${a.id}`,
      kind: "let_go",
      /* Never "high": nothing here is a mistake to correct, only a question
         worth asking, so it never crowds out a real clutter claim. */
      confidence: "medium",
      verb: "Let go",
      sourceId: a.id,
      sourceName: NAME(a.text),
      targetId: a.id,
      targetName: NAME(a.text),
      reason: overdue
        ? `its own deadline passed ${days} days ago and it is still open`
        : `kept for ${days} days without being closed — nothing will fade it`,
      score: 40 + Math.min(days, 40),
      origin: "local",
    });
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
        origin: "local",
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
