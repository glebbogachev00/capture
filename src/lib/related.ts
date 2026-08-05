import type { Action, Board, Intention, Thread } from "./model";

/**
 * Related — "what else in here actually connects to this?"
 *
 * Deliberately strict, because noise is worse than nothing. A connection is
 * only claimed when two items share something specific:
 *
 *   1. a contiguous phrase of content words ("cold brew"), or
 *   2. distinctive words — exact token matches, non-generic, and shared by
 *      only a small fraction of the board ("perfectionism").
 *
 * Matching is token-exact: "text" never matches inside "context", "cross"
 * never matches inside "across". Generic overlap ("content", "capture",
 * "app", "sharing"…) is NOT a connection — those words link everything and
 * mean nothing, so they surface nothing: the Related line simply does not
 * render. Runs on plain text locally — no model, no quota, instant — and
 * every suggestion carries the shared words as a reason you can verify.
 * Nothing is written to the board; the app never auto-links anything.
 */

export type RelatedTarget = {
  kind: "action" | "thread" | "intention";
  id: string;
};

export type RelatedItem = {
  kind: "action" | "thread" | "intention";
  id: string;
  name: string;
  /** Why: a shared phrase, or a short quoted window around a shared word. */
  reason: string;
  /** For thread hits: the id of the fragment that carries the match, so the
      UI can offer one-tap Move/Extract on that exact fragment. */
  fragId?: string;
};

export type Related = {
  items: RelatedItem[];
};

/** Connector words and everyday verbs that say nothing about a subject. */
const STOP = new Set([
  "this", "that", "these", "those", "with", "from", "have", "they",
  "them", "what", "when", "where", "which", "about", "into", "than",
  "then", "there", "here", "your", "just", "really", "some", "going",
  "want", "need", "make", "like", "back", "over", "will", "would",
  "could", "should", "been", "being", "were", "was", "had", "has",
  "after", "before", "because", "while", "though", "still", "even",
  "also", "much", "many", "more", "most", "other", "another", "every",
  "each", "their", "thing", "things", "something", "anything", "doing",
  "across", "between", "through", "within", "without", "during",
  "around", "against", "under", "above", "below", "behind", "among",
  "onto", "upon", "along", "toward", "towards",
  "check", "checks", "checked", "checking", "add", "adds", "added",
  "adding", "remove", "removes", "removed", "removing", "delete",
  "deletes", "deleted", "start", "started", "starting", "stop",
  "stopped", "stopping", "keep", "keeps", "kept", "get", "gets", "got",
  "put", "puts", "set", "sets", "setting", "sort", "sorts", "sorted",
  "sorting", "open", "opens", "opened", "close", "closes", "closed",
  "save", "saves", "saved", "saving", "send", "sends", "sent",
  "sending", "post", "posts", "posted", "posting", "note", "notes",
  "noted", "read", "reads", "writing", "write", "wrote", "tell",
  "tells", "told", "ask", "asks", "asked", "use", "uses", "used",
  "using", "look", "looks", "looked", "see", "sees", "saw", "seen",
  "know", "knows", "knew", "think", "thinks", "thought", "feel",
  "feels", "felt", "say", "says", "said", "give", "gives", "gave",
  "given", "take", "takes", "took", "taken", "bring", "brings", "brought",
  "i've", "i'm", "it's", "you've", "we've", "they've", "that's", "this's",
  "don't", "won't", "can't", "didn't", "doesn't", "isn't", "aren't",
  "wasn't", "weren't", "haven't", "hasn't", "hadn't", "good", "great",
  "better", "best", "new", "old", "first", "last", "next", "sure",
  "nice", "fine", "okay", "easy", "hard", "simple", "simply", "whole",
  "full", "totally", "actually", "pretty", "quite", "rather", "fairly",
]);

/** App-domain and boilerplate words that appear all over this app, so two
    items sharing one of them means nothing. Distinctive content words
    ("cold brew", "perfectionism", "iPad") are NOT here. */
const GENERIC = new Set([
  "content", "contents", "capture", "captures", "capturing", "captured",
  "app", "apps", "application", "applications", "thread", "threads",
  "fragment", "fragments", "action", "actions", "intention", "intentions",
  "principle", "principles", "stuff", "someone", "anyone", "everyone",
  "work", "works", "worked", "working", "project", "projects",
  "plan", "plans", "planned", "planning", "idea", "ideas", "time",
  "times", "day", "days", "week", "weeks", "month", "months", "year",
  "years", "today", "tomorrow", "yesterday", "people", "person",
  "share", "shares", "shared", "sharing", "copy", "copies", "copied",
  "sync", "syncing", "synced", "device", "devices", "phone", "phones",
  "laptop", "computer", "screen", "settings", "system", "systems",
  "update", "updates", "updated", "updating", "link", "links", "page",
  "pages", "list", "lists", "establishes", "established", "remains",
  "remained", "provide", "provides", "provided", "serve", "serves",
  "served", "focus", "focuses", "focused", "involve", "involves",
  "involved", "include", "includes", "included", "including",
  "currently", "presently", "overall", "basically", "essentially",
  "actually", "search", "searches", "searched", "searchable",
]);

/** Lowercased tokens of a text — the unit of matching. Exact token equality
    only: "text" can never match inside "context". */
const tokens = (s: string) => s.toLowerCase().match(/[a-z][a-z0-9']*/g) || [];

/** Content words: tokens that survive the stop/generic lists and are long
    enough to mean something. */
function contentWords(s: string): string[] {
  return tokens(s).filter(
    (w) => w.length >= 4 && !STOP.has(w) && !GENERIC.has(w)
  );
}

function itemText(a: Action): string {
  return [a.text, a.src].filter(Boolean).join(" ");
}
function threadText(t: Thread): string {
  return [
    t.name,
    t.summary,
    ...(t.frags || []).map((f) => f.text),
  ]
    .filter(Boolean)
    .join(" ");
}
function intentionText(i: Intention): string {
  return [
    i.expandedIntention,
    i.rawInput,
    ...i.recommendedActions,
    ...i.counterIntentions,
  ]
    .filter(Boolean)
    .join(" ");
}

function textOf(board: Board, kind: RelatedTarget["kind"], id: string): string {
  if (kind === "action") {
    return itemText(board.actions.find((a) => a.id === id) || ({} as Action));
  }
  if (kind === "thread") {
    return threadText(board.threads.find((t) => t.id === id) || ({} as Thread));
  }
  return intentionText(
    board.intentions.find((i) => i.id === id) || ({} as Intention)
  );
}

/** How many items across the board contain each word. A word shared by
    everything means nothing; a word in only a few items is distinctive. */
function rarity(board: Board): Map<string, number> {
  const counts = new Map<string, number>();
  const bump = (s: string) => {
    for (const w of new Set(contentWords(s)))
      counts.set(w, (counts.get(w) || 0) + 1);
  };
  for (const a of board.actions) bump(itemText(a));
  for (const t of board.threads) bump(threadText(t));
  for (const i of board.intentions) bump(intentionText(i));
  return counts;
}

/** The shared phrase of the target's content words appearing contiguously in
    the other text — a real phrase ("cold brew"), never a word list. Capped
    at PHRASE_CAP words: a shared source block reads as a wall, not a reason.
    Among equal-length candidates the window with the longest words wins, so
    the reason is the meat of the match. */
const PHRASE_CAP = 4;

function longestSharedRun(target: string[], other: string[]): string {
  const otherSet = new Set(other);
  let bestLen = 0;
  for (let i = 0; i < target.length; i++) {
    for (let j = 0; j < other.length; j++) {
      let k = 0;
      while (
        i + k < target.length &&
        j + k < other.length &&
        target[i + k] === other[j + k]
      )
        k++;
      if (k > bestLen) bestLen = k;
    }
  }
  if (bestLen < 2) return "";
  const runLen = Math.min(bestLen, PHRASE_CAP);
  /* Among runLen-word windows of the target that ARE present in the other
     text (possibly a sub-window of a longer match), prefer the one whose
     words carry the most information. */
  let bestWin = "";
  let bestWeight = -1;
  for (let i = 0; i + runLen <= target.length; i++) {
    const win = target.slice(i, i + runLen);
    if (!win.every((w) => otherSet.has(w))) continue;
    const text = win.join(" ");
    const weight = text.replace(/\s/g, "").length;
    if (weight > bestWeight) {
      bestWeight = weight;
      bestWin = text;
    }
  }
  return bestWin;
}

/** Short quoted window of the text around the shared word, so the reason is
    a sentence you can verify, not a bare word. Collapsed to one line. */
function quoteAround(word: string, all: string[]): string {
  const idx = all.indexOf(word);
  if (idx === -1) return `"${word}"`;
  const from = Math.max(0, idx - 8);
  const to = Math.min(all.length, idx + 9);
  const win = all
    .slice(from, to)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return (from > 0 ? "…" : "") + win + (to < all.length ? "…" : "");
}

const NAME = (s: string) => s.slice(0, 60) + (s.length > 60 ? "…" : "");

type Hit = {
  kind: "action" | "thread" | "intention";
  id: string;
  name: string;
  reason: string;
  score: number;
  fragId?: string;
  phrase?: string;
};

function hitsFor(board: Board, text: string, excludeId?: string): Hit[] {
  const targetWords = contentWords(text);
  const counts = rarity(board);

  /* A word is distinctive while it appears in only a small fraction of the
     board — a quarter, at least two items. At 4+ sharers it is noise. */
  const itemCount =
    board.actions.length + board.threads.length + board.intentions.length;
  const maxShare = Math.max(2, Math.floor(itemCount / 4));

  type Signal = {
    score: number;
    reason: string;
    phrase?: string;
    word?: string;
  };
  const consider = (otherText: string): Signal | null => {
    const otherWords = contentWords(otherText);
    const phrase = longestSharedRun(targetWords, otherWords);
    if (phrase)
      return {
        score: 100 + phrase.split(" ").length,
        reason: `both mention "${phrase}"`,
        phrase,
      };
    /* Single-word signals: exact matches, distinctive, non-generic. */
    const shared = [...new Set(targetWords)].filter(
      (w) => (counts.get(w) || 0) <= maxShare && otherWords.includes(w)
    );
    if (!shared.length) return null;
    const best = shared.sort(
      (x, y) => (counts.get(x) || 99) - (counts.get(y) || 99) || y.length - x.length
    )[0];
    return { score: shared.length, reason: quoteAround(best, tokens(otherText)), word: best };
  };

  const hits: Hit[] = [];
  for (const a of board.actions) {
    if (a.id === excludeId) continue;
    const sig = consider(itemText(a));
    if (sig) hits.push({ kind: "action", id: a.id, name: NAME(a.text), ...sig });
  }
  for (const t of board.threads) {
    if (t.id === excludeId) continue;
    const sig = consider(threadText(t));
    if (!sig) continue;
    /* Find the fragment that carries the match, so the row can offer
       one-tap Move/Extract on that exact fragment. */
    const probe = (sig.phrase || sig.word || "") as string;
    const probeWords = probe.split(" ");
    const fragId = (t.frags || []).find((f) => {
      const toks: string[] = tokens(f.text);
      /* The thread connected on these words; the fragment that carries them
         (in order, stop words between allowed — "cold strong brew" still
         shares "cold brew") is the one Move/Extract should target. */
      let i = 0;
      for (const tk of toks) {
        if (tk === probeWords[i]) i++;
        if (i === probeWords.length) return true;
      }
      return false;
    })?.id;
    hits.push({ kind: "thread", id: t.id, name: NAME(t.name), fragId, ...sig });
  }
  for (const i of board.intentions) {
    if (i.id === excludeId) continue;
    const sig = consider(intentionText(i));
    if (sig)
      hits.push({
        kind: "intention",
        id: i.id,
        name: NAME(i.expandedIntention || i.rawInput),
        ...sig,
      });
  }

  /* Strongest signal first; among equals, threads before actions before
     intentions (thread reasons are the most concrete). Cap keeps it a line. */
  const order = { thread: 0, action: 1, intention: 2 } as const;
  return hits.sort(
    (x, y) => y.score - x.score || order[x.kind] - order[y.kind]
  );
}

export function relatedTo(board: Board, target: RelatedTarget): Related {
  return {
    items: hitsFor(board, textOf(board, target.kind, target.id), target.id)
      .slice(0, 3)
      .map(({ kind, id, name, reason, fragId }) => ({ kind, id, name, reason, fragId })),
  };
}

/** Same engine as relatedTo, but the target is a piece of raw text rather
    than an item already on the board. Used for a capture that has just
    landed and is not yet the thing it may belong with. */
export function relatedToText(board: Board, text: string): Related {
  return {
    items: hitsFor(board, text)
      .slice(0, 3)
      .map(({ kind, id, name, reason, fragId }) => ({ kind, id, name, reason, fragId })),
  };
}

/**
 * The thread a piece of text clearly belongs with, or none.
 *
 * Deliberately stricter than the Related line: only a shared phrase — never
 * a lone shared word, however rare — is strong enough to say "this belongs
 * with X". The Related line's job is discovery and may suggest loosely; a
 * proposed merge must be concrete and verifiable, because acting on it
 * moves something. Only threads are homes (an action is a to-do, not a
 * place); the strongest thread hit is returned, if there is one.
 */
export function bestThreadHome(
  board: Board,
  text: string,
  excludeId?: string
): RelatedItem | null {
  const hit = hitsFor(board, text, excludeId).find(
    (h) => h.kind === "thread" && h.phrase
  );
  if (!hit) return null;
  return { kind: "thread", id: hit.id, name: hit.name, reason: hit.reason };
}  /**
   * The existing action a piece of text clearly duplicates, or none.
   *
   * Same strict bar as bestThreadHome: only a shared phrase — never a lone
   * shared word — is enough to claim two actions say the same thing. A
   * thread is a home, but an action is a to-do: the claim here is not
   * "belongs with" but "is the same task twice", and acting on it deletes
   * one of the pair, so it must be concrete. The strongest action hit is
   * returned, if there is one. excludeId drops the capture itself — a
   * fresh action always phrase-matches its own text, and it sits at the
   * front of the list, so without the exclusion the self-match would be
   * reported as the duplicate. With several true duplicates the newest one
   (the board lists newest first) is named — a stable, deterministic pick.
   */
export function bestActionDuplicate(
  board: Board,
  text: string,
  excludeId?: string
): RelatedItem | null {
  const hit = hitsFor(board, text, excludeId).find(
    (h) => h.kind === "action" && h.phrase
  );
  if (!hit) return null;
  return { kind: "action", id: hit.id, name: hit.name, reason: hit.reason };
}

/** A fragment that a piece of text clearly duplicates. */
export type FragDuplicate = {
  threadId: string;
  fragId: string;
  threadName: string;
  name: string;
  reason: string;
};

/**
 * The existing fragment a piece of text clearly duplicates, or none.
 *
 * Fragments are long-form notes, so the bar is one notch higher than the
 * action duplicate: a shared phrase of THREE content words — never a lone
 * word, and never a two-word overlap that any two notes on the same subject
 * would share ("espresso machine" is a connection, not a duplicate).
 * Pasting the same note twice survives the sorter's rewording with long
 * runs intact, so the strong cases are caught while incidental overlap in
 * a long-running thread stays quiet. The newest capture is always the one
 * proposed for removal — the original, with its images, is never at risk.
 * excludeFragId drops the just-landed fragment, which always phrase-matches
 * its own text.
 */
export function bestFragmentDuplicate(
  board: Board,
  text: string,
  excludeFragId?: string
): FragDuplicate | null {
  const target = contentWords(text);
  if (!target.length) return null;
  let best: FragDuplicate | null = null;
  let bestLen = -1;
  for (const t of board.threads) {
    for (const f of t.frags || []) {
      if (f.id === excludeFragId) continue;
      const phrase = longestSharedRun(target, contentWords(f.text));
      if (!phrase || phrase.split(" ").length < 3) continue;
      /* The longest phrase wins; among equals the first found stays. */
      if (best && phrase.length <= bestLen) continue;
      best = {
        threadId: t.id,
        fragId: f.id,
        threadName: t.name,
        name: NAME(f.text),
        reason: `both mention "${phrase}"`,
      };
      bestLen = phrase.length;
    }
  }
  return best;
}
