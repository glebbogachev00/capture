import { spokenText } from "./caption";
import type { Action, Board, Intention, Thread } from "./model";

/**
 * Relatedness — "does this actually belong with that?"
 *
 * The shared matching engine behind the capture suggestion, the Organize
 * scan and the grouped lens. Deliberately strict, because noise is worse
 * than nothing: a connection is only claimed when two texts share
 *
 *   1. a contiguous phrase of content words ("cold brew"), or
 *   2. distinctive words — exact token matches, non-generic, and shared by
 *      only a small fraction of the board ("perfectionism").
 *
 * Matching is token-exact: "text" never matches inside "context", "cross"
 * never matches inside "across". Generic overlap ("content", "capture",
 * "app", "sharing"…) is NOT a connection — those words link everything and
 * mean nothing, so they surface nothing at all. Runs on plain text locally
 * — no model, no quota, instant — and every claim carries the shared words
 * as a reason you can verify. Nothing is written to the board; the app
 * never auto-links anything.
 *
 * The `best*` functions are the strict ones (a phrase, never a lone word),
 * because acting on what they return MOVES something.
 */

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
  /* Deliberation hedges. They pass every other filter — long enough, not
     stopwords — and then read as though they were the subject: an
     answered undo wrote the rule `Captures about "wondering whether" are
     an action`, which is a rule about nothing and fires on any hedged
     capture. The same words made the duplicate check offer to merge two
     unrelated captures because "both mention wondering whether". */
  "wondering", "wonder", "wondered", "thinking", "think", "thought",
  "thoughts", "maybe", "perhaps", "probably", "possibly", "really",
  "whether", "should", "could", "would", "might", "kinda", "sorta",
  "guess", "guessing", "unsure", "considering", "consider",
  /* Filler adverbs that survive every filter and then get written into a
     learned rule as though they were the subject: an undo produced
     `Captures about "finally recycling"`, half of which is nothing. */
  "finally", "eventually", "definitely", "honestly", "literally",
  /* A verdict about a thing is not the thing. Two captures that both say
     something "needs improvement" share a judgement, not a subject — and
     the phrase is long enough and rare enough to pass every other gate. */
  "improve", "improves", "improved", "improving", "improvement",
  "improvements",
]);

/** Lowercased tokens of a text — the unit of matching. Exact token equality
    only: "text" can never match inside "context". */
const tokens = (s: string) => s.toLowerCase().match(/[a-z][a-z0-9']*/g) || [];

/**
 * Ordinary inflections of a word, tested only for list membership.
 *
 * The lists above name a word once and were expected to cover it — but
 * "need" was on STOP while "needs" was not, so "needs improvement" read as
 * a subject two captures shared, and the board offered to merge an action
 * into a thread over a phrase that says nothing about either. Every list
 * entry was one plural away from the same hole. Membership is asked of the
 * stems too, so naming a word filters the word.
 *
 * Never changes the word quoted back in a reason — only whether it counts.
 */
function stems(w: string): string[] {
  const out = [w];
  if (w.endsWith("ies") && w.length > 4) out.push(w.slice(0, -3) + "y");
  if (w.endsWith("es") && w.length > 3) out.push(w.slice(0, -2));
  if (w.endsWith("s") && !w.endsWith("ss")) out.push(w.slice(0, -1));
  if (w.endsWith("ing") && w.length > 5) {
    const base = w.slice(0, -3);
    out.push(base, base + "e");
  }
  if (w.endsWith("ed") && w.length > 4) {
    const base = w.slice(0, -2);
    out.push(base, base + "e");
  }
  return out;
}

/** Is this word one the matcher should ignore?
 *
 * Inflections are resolved against STOP only. STOP is a closed grammatical
 * class — a connector or everyday verb is exactly as empty in every form,
 * so naming it once names all of them. GENERIC is a hand-tuned list of
 * words that happen to be everywhere on THIS board, and widening it by
 * stem was measurably too broad: it swallowed "copying", which cost the
 * duplicate check a real match between two near-identical notes. Those
 * forms are enumerated deliberately, so they are matched as written.
 */
const ignored = (w: string) =>
  GENERIC.has(w) || stems(w).some((s) => STOP.has(s));


/* Every text that reaches the matcher goes through spokenText: a photo
   caption describes a picture, and letting it claim connections meant a
   screenshot of the board linked whatever it happened to show. */
function itemText(a: Action): string {
  return spokenText([a.text, a.src].filter(Boolean).join(" "));
}
function threadText(t: Thread): string {
  return spokenText(
    [t.name, t.summary, ...(t.frags || []).map((f) => f.text)]
      .filter(Boolean)
      .join(" ")
  );
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
  /** The phrase is the thread's own name, not something buried in its prose. */
  named?: boolean;
  /** The matched item's text, for checks that need the words as written. */
  raw?: string;
};


/**
 * Were these words written next to each other, or only made neighbours by
 * throwing the small words away?
 *
 * Matching strips connectives, so "Publish articles and quotes on X" offers
 * up "articles quotes" as a contiguous phrase — and on a real board that is
 * where the bad claims came from: "articles quotes", "increase efficiency"
 * (from "increase the efficiency"), "feedback slow". None of those are
 * things anyone said. The pairs that were right had been written as
 * written: "cold brew", "kitchen renovation", "espresso machine".
 *
 * So for the shortest phrases — two words, where there is no length to lean
 * on — the words have to be adjacent in the text as the person typed it,
 * on BOTH sides. A compound survives; two words that merely shared a
 * sentence do not.
 */
function writtenTogether(phrase: string, text: string): boolean {
  const want = phrase.split(" ");
  const raw = tokens(text);
  for (let i = 0; i + want.length <= raw.length; i++) {
    let ok = true;
    for (let j = 0; j < want.length; j++) {
      if (!stems(raw[i + j]).includes(want[j])) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
}

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
    const runWords = phrase ? phrase.split(" ") : [];
    /* A run of one word is not a phrase — it used to score 101 and skip the
       rarity gate below, so the commonest word on the board could out-rank
       every real signal. Length is evidence in its own right: three words in
       a row is a quotation, and stays a signal however common the words are
       (on a three-item board, three copies of one task make every word look
       common). A two-word run is the weakest thing still worth calling a
       phrase, so it has to be distinctive to count. */
    if (
      runWords.length >= 3 ||
      (runWords.length === 2 &&
        runWords.some((w) => (counts.get(w) || 0) <= maxShare))
    )
      return {
        score: 100 + runWords.length,
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
    /* Did the phrase come from the thread's NAME, or from its prose?
     *
     * The two are not the same evidence. A capture that says "for the
     * kitchen renovation" against a thread called "Kitchen renovation" has
     * named its destination out loud. The same two words found somewhere
     * inside a thread's notes is coincidence more often than not — every
     * bad claim measured on a real board came from prose ("articles
     * quotes", "feedback slow", "development necessary"), and every claim
     * that was right either named the thread or ran to three words. */
    const named = !!sig.phrase && !!longestSharedRun(
      contentWords(text),
      contentWords(spokenText(t.name))
    )?.startsWith(sig.phrase);
    hits.push({ kind: "thread", id: t.id, name: NAME(t.name), fragId, named, raw: threadText(t), ...sig });
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
  excludeId?: string,
  /* Three words, not two.
   *
   * A "phrase" here can be as short as two content words, and two words
   * turned out not to be evidence of anything. Measured against a real
   * 19-thread board, seven of eleven proposed homes rested on a two-word
   * match, and most were coincidence: "Publish articles and quotes on X"
   * was sent to "Reducing friction strategy" because both said "articles
   * quotes"; "Wire up Capture to the agents I use" was sent to "Bugs,
   * Issues and Additions" because both said "development necessary". Every
   * one of the four three-word matches was right.
   *
   * So the bar is three, which is also what the capture-time duplicate
   * banner already settled on for the same reason. A suggestion that is
   * wrong more often than not is worse than no suggestion: it trains you to
   * dismiss the whole feature without reading it. */
  minPhraseWords = 3
): RelatedItem | null {
  const hit = hitsFor(board, text, excludeId).find((h) => {
    if (h.kind !== "thread") return false;
    const words = h.phrase?.split(" ").length ?? 0;
    /* Naming the thread is evidence in its own right. */
    if (h.named) return words >= 2;
    if (words >= minPhraseWords) return true;
    /* Two words only count as a compound the person actually wrote — on
       both sides. */
    return (
      words === 2 &&
      writtenTogether(h.phrase!, text) &&
      writtenTogether(h.phrase!, h.raw ?? "")
    );
  });
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
  excludeId?: string,
  /* How much overlap the claim costs. Tidy asks for one word and rates
     what it finds — a two-word hit is medium and sits behind a tap. The
     banner that interrupts a capture cannot be that cheap: it asserts
     "this duplicates X" with no tier at all, and at two words it fired on
     captures that merely shared a turn of phrase. Worse, a learned rule
     needs exactly two shared words, so the pair that proved a rule was
     always also accused of being a copy of itself. */
  minPhraseWords = 1,
  /* How much of the shorter task must be shared. Lowered to zero when this
     is generating CANDIDATES for a model to judge rather than claims to
     show a person: there, recall is the job and precision is the judge's. */
  coverage = ACTION_DUP_COVERAGE
): RelatedItem | null {
  const words = contentWords(text);
  const hit = hitsFor(board, text, excludeId).find((h) => {
    if (h.kind !== "action") return false;
    if ((h.phrase?.split(" ").length ?? 0) < minPhraseWords) return false;
    /* A shared run of words is not the same task twice.
     *
     * On a real board the run alone claimed that "Publish articles and
     * quotes on X" duplicated "Define workflow for agents", and that
     * "Create a portfolio for Dom" duplicated "Mention to the parent that
     * Dom has two lessons left" — eleven claims, none of them real, each
     * offering to delete one of the pair. Raising the run to three words
     * only cut it to five, still none real, because length was never the
     * question. The question is how much of the shorter task the two
     * actually have in common. */
    const other = board.actions.find((a) => a.id === h.id);
    return !!other && (coverage <= 0 || covers(words, contentWords(other.text), coverage));
  });
  if (!hit) return null;
  return { kind: "action", id: hit.id, name: hit.name, reason: hit.reason };
}

/** Content words of a text — the unit of matching. Exported so the
    board-wide scan can count rarity across the whole board with the exact
    same token rules the connections use. */
export function contentWords(s: string): string[] {
  return tokens(s).filter((w) => w.length >= 4 && !ignored(w));
}

/** The longest shared run of content words between two plain texts, or
    "" when they share nothing distinctive. Exported so a board-wide scan
    can compare whole items (two threads, say) with the same matching rules
    without re-implementing them. */
export function sharedPhrase(a: string, b: string): string {
  return longestSharedRun(contentWords(a), contentWords(b));
}

/**
 * The matched phrase as the text actually writes it.
 *
 * A shared phrase is a run of CONTENT words, so it can read like machine
 * output: "step-by-step" matches as "step step", "source of self" as
 * "source self". Quoting that at the user explains nothing. This expands
 * the run back to the raw substring — the phrase words in order, small
 * words allowed between — so the quote is language the user wrote. Falls
 * back to the bare phrase if the text no longer carries it.
 */
export function phraseAsWritten(phrase: string, text: string): string {
  const want = phrase.split(" ").filter(Boolean);
  if (!want.length) return phrase;
  const toks: { w: string; start: number; end: number }[] = [];
  for (const m of text.matchAll(/[a-zA-Z][a-zA-Z0-9']*/g)) {
    toks.push({
      w: m[0].toLowerCase(),
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  /* The tightest window carrying the words in order; up to four filler
     tokens keeps "step by step" together without quoting half a sentence. */
  let best: { start: number; end: number } | null = null;
  for (let s = 0; s < toks.length; s++) {
    if (toks[s].w !== want[0]) continue;
    let need = 1;
    let last = s;
    for (
      let j = s + 1;
      j < toks.length && need < want.length && j - s < want.length + 4;
      j++
    ) {
      if (toks[j].w === want[need]) {
        need++;
        last = j;
      }
    }
    if (need < want.length) continue;
    const win = { start: toks[s].start, end: toks[last].end };
    if (!best || win.end - win.start < best.end - best.start) best = win;
  }
  if (!best) return phrase;
  return text.slice(best.start, best.end).replace(/\s+/g, " ").trim();
}

/** A fragment that a piece of text clearly duplicates. */
export type FragDuplicate = {
  threadId: string;
  fragId: string;
  threadName: string;
  name: string;
  reason: string;
};

/** A fragment that a piece of text overlaps with — the same note again, or
    just another note on the same subject. `duplicate` separates the two. */
export type FragOverlap = FragDuplicate & {
  /** True only for the same note twice. False means real overlap that must
      never be offered for deletion — a merge or a move at most. */
  duplicate: boolean;
};

/**
 * Whether two notes are the same note twice, rather than two notes that talk
 * about the same thing.
 *
 * A shared run of words cannot decide this on its own. Notes about one
 * subject share the subject's name, and a name is often three content words
 * by itself — "Reality Creation Game", "cold brew setup" — so a run-only test
 * called plainly unrelated notes duplicates and offered to delete one of
 * them. The claim has to be about the WHOLE note:
 *
 *   - most of the shorter note's vocabulary is present in the other, and
 *   - the two notes are of comparable size — a short note quoted inside a
 *     long one is a quotation, not a copy.
 *
 * Deliberately forgiving on wording (the sorter rewords a re-paste) and
 * unforgiving on scope: a pasted-twice note covers itself almost entirely,
 * while two notes sharing a title do not come close.
 */
const DUP_MIN_WORDS = 3;
const DUP_COVERAGE = 0.7;
/* Actions are one line long, so their content-word count is tiny and a
   single differing verb is a big share of it: "Schedule the dentist
   appointment" and "Book a dentist appointment" are plainly the same task
   and share only two words of three. The looser bar is affordable here
   because coverage is a far stricter test than the contiguous run it sits
   on top of — measured against a real board, the run alone produced eleven
   duplicate claims and not one was a duplicate. */
const ACTION_DUP_COVERAGE = 0.6;
const DUP_SIZE_RATIO = 0.5;

/** How much of the shorter text the two share. The size guard keeps a short
    text quoted inside a long one from reading as a copy of it. */
function covers(a: string[], b: string[], threshold: number): boolean {
  const A = new Set(a);
  const B = new Set(b);
  const [small, big] = A.size <= B.size ? [A, B] : [B, A];
  /* A note of one or two distinct words covers anything it touches. */
  if (small.size < DUP_MIN_WORDS) return false;
  if (small.size / big.size < DUP_SIZE_RATIO) return false;
  let shared = 0;
  for (const w of small) if (big.has(w)) shared++;
  return shared / small.size >= threshold;
}

function sameNote(a: string[], b: string[]): boolean {
  return covers(a, b, DUP_COVERAGE);
}

/**
 * The existing fragment a piece of text overlaps with, or none.
 *
 * Two gates, and the caller needs both answers. First a shared phrase of
 * THREE content words — never a lone word, and never a two-word overlap that
 * any two notes on the same subject would share ("espresso machine" is a
 * connection, not a duplicate). That says the notes touch. Then `sameNote`
 * says whether they are the SAME note: a phrase alone was never enough, and
 * treating it as enough is what put a Remove button under notes that merely
 * named the same thing.
 *
 * The newest capture is always the one proposed to move or go — the
 * original, with its images, is never at risk. excludeFragId drops the
 * just-landed fragment, which always phrase-matches its own text.
 */
export function bestFragmentOverlap(
  board: Board,
  text: string,
  excludeFragId?: string
): FragOverlap | null {
  const target = contentWords(text);
  if (!target.length) return null;
  let best: FragOverlap | null = null;
  let bestLen = -1;
  for (const t of board.threads) {
    for (const f of t.frags || []) {
      if (f.id === excludeFragId) continue;
      const other = contentWords(f.text);
      const phrase = longestSharedRun(target, other);
      if (!phrase || phrase.split(" ").length < 3) continue;
      const duplicate = sameNote(target, other);
      /* A true duplicate always beats a mere overlap, however long the
         overlap's phrase; within a tier the longest phrase wins, and among
         equals the first found stays. */
      if (best && best.duplicate && !duplicate) continue;
      if (best && best.duplicate === duplicate && phrase.length <= bestLen)
        continue;
      best = {
        threadId: t.id,
        fragId: f.id,
        threadName: t.name,
        name: NAME(f.text),
        reason: `both mention "${phrase}"`,
        duplicate,
      };
      bestLen = phrase.length;
    }
  }
  return best;
}

/**
 * The existing fragment a piece of text clearly duplicates, or none.
 *
 * The narrow, destructive question: is this the same note twice? Only a
 * whole-note match answers yes (see `sameNote`). Everything weaker is
 * overlap, and overlap is `bestFragmentOverlap`'s to report — acting on
 * this one DELETES a note, so it may never fire on two notes that merely
 * share a name.
 */
export function bestFragmentDuplicate(
  board: Board,
  text: string,
  excludeFragId?: string
): FragDuplicate | null {
  const hit = bestFragmentOverlap(board, text, excludeFragId);
  if (!hit) return null;
  const { duplicate, ...dup } = hit;
  return duplicate ? dup : null;
}

/**
 * Do two texts read as the same note — the fragment-duplicate bar
 * (a shared run of three content words, then coverage of the shorter),
 * exported for callers that hold the texts rather than a board. The
 * receipts scan uses it: a completion receipt restating a note is the
 * note's own task, finished.
 */
export function sameNoteText(a: string, b: string): boolean {
  const wa = contentWords(a);
  const wb = contentWords(b);
  if (!wa.length || !wb.length) return false;
  const phrase = longestSharedRun(wa, wb);
  if (!phrase || phrase.split(" ").length < 3) return false;
  return covers(wa, wb, DUP_COVERAGE);
}
