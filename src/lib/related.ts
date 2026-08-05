import type { Action, Board, Intention, Thread } from "./model";
import { search } from "./search";

/**
 * Related — "what else in here connects to this?"
 *
 * The intelligence layer, kept deliberately dumb: relatedness is computed
 * from the same plain search index the search box uses, so it costs nothing,
 * works offline, is instant, and every suggestion carries a reason you can
 * verify — the shared words. Nothing is written to the board; the app never
 * auto-links anything. This is discovery, not graph work.
 *
 * A raw sentence is a bad query (search requires every term to match), so
 * the item is distilled to its most linking words — terms that at least
 * one OTHER item also contains (unique words can never connect anything),
 * preferring the ones fewest items share. Two terms keeps precision high;
 * if that finds nothing, a single term is tried once, so a quiet board
 * still surfaces the one real connection.
 */

export type RelatedTarget = {
  kind: "action" | "thread" | "intention";
  id: string;
};

export type RelatedItem = {
  kind: "action" | "thread" | "intention";
  id: string;
  name: string;
  /** The reason, phrased as the shared words: `both mention "cold brew"`. */
  reason: string;
};

export type Related = {
  items: RelatedItem[];
};

/* Words too generic to say anything about a subject. The length filter
   already drops most of them; this catches the short-but-frequent ones. */
const STOP = new Set([
  "this", "that", "these", "those", "with", "from", "have", "they",
  "them", "what", "when", "where", "which", "about", "into", "than",
  "then", "there", "here", "your", "just", "really", "some", "going",
  "want", "need", "make", "like", "back", "over", "will", "would",
  "could", "should", "been", "being", "were", "was", "had", "has",
  "after", "before", "because", "while", "though", "still", "even",
  "also", "much", "many", "more", "most", "other", "another", "every",
  "each", "their", "thing", "things", "something", "anything", "doing",
]);

const words = (s: string) =>
  (s.toLowerCase().match(/[a-z][a-z0-9']{2,}/g) || []).filter(
    (w) => w.length >= 4 && !STOP.has(w)
  );

function itemText(a: Action): string {
  return [a.text, a.src].filter(Boolean).join(" ");
}
function threadText(t: Thread): string {
  return [
    t.name,
    t.summary,
    ...t.frags.map((f) => f.text),
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

/** How many items across the board contain the term. A term found in only
    one item can never link anything; a term in everything links everything
    and means nothing. The sweet spot is shared-but-specific. */
function rarity(board: Board): Map<string, number> {
  const counts = new Map<string, number>();
  const bump = (s: string) => {
    for (const w of new Set(words(s))) counts.set(w, (counts.get(w) || 0) + 1);
  };
  for (const a of board.actions) bump(itemText(a));
  for (const t of board.threads) bump(threadText(t));
  for (const i of board.intentions) bump(intentionText(i));
  return counts;
}

/** The most linking terms of one item, most-specific first, at most `n`.
    Only terms shared with at least one other item qualify. */
function distinctive(text: string, counts: Map<string, number>, n: number) {
  return [...new Set(words(text))]
    .filter((w) => (counts.get(w) || 0) >= 2)
    .sort((a, b) => {
      const r = (counts.get(a) || 0) - (counts.get(b) || 0);
      if (r !== 0) return r;
      if (b.length !== a.length) return b.length - a.length;
      return a < b ? -1 : 1;
    })
    .slice(0, n);
}

function sharedPhrase(query: string, item: string): string {
  const shared = query
    .split(/\s+/)
    .filter((w) => item.toLowerCase().includes(w));
  if (!shared.length) return query;
  /* Present the shared words in the order they appear in the target item,
     so the reason reads like a real phrase ("cold brew", not "brew cold"). */
  const lower = item.toLowerCase();
  return shared
    .sort((a, b) => lower.indexOf(a) - lower.indexOf(b))
    .join(" ");
}

const NAME = (s: string) => s.slice(0, 60) + (s.length > 60 ? "…" : "");

export function relatedTo(board: Board, target: RelatedTarget): Related {
  const text = textOf(board, target.kind, target.id);
  const counts = rarity(board);
  const isSelf = (item: { id: string }) => item.id === target.id;

  const collect = (query: string): RelatedItem[] => {
    const hits = search(board, query);
    const items: RelatedItem[] = [];

    for (const a of hits.actions) {
      if (isSelf(a)) continue;
      items.push({
        kind: "action",
        id: a.id,
        name: NAME(a.text),
        reason: `both mention "${sharedPhrase(query, itemText(a))}"`,
      });
    }
    for (const { thread: t, frags } of hits.threads) {
      if (isSelf(t)) continue;
      const frag = frags[0];
      items.push({
        kind: "thread",
        id: t.id,
        name: NAME(t.name),
        reason: frag
          ? `"${NAME(frag.text)}"`
          : `both mention "${sharedPhrase(query, threadText(t))}"`,
      });
    }
    for (const i of hits.intentions) {
      if (isSelf(i)) continue;
      items.push({
        kind: "intention",
        id: i.id,
        name: NAME(i.expandedIntention || i.rawInput),
        reason: `both mention "${sharedPhrase(query, intentionText(i))}"`,
      });
    }

    /* Threads that matched on an actual fragment rank first — the reason
       is concrete — then actions, then intentions. Capped so the line
       stays a line. */
    const order = { thread: 0, action: 1, intention: 2 } as const;
    return items.sort((x, y) => order[x.kind] - order[y.kind]).slice(0, 3);
  };

  const top = distinctive(text, counts, 2);
  if (!top.length) return { items: [] };
  const two = collect(top.join(" "));
  if (two.length) return { items: two };
  /* Two terms was too strict — one rare term still catches the real link. */
  return { items: collect(top[0]) };
}
