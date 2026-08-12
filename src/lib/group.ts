import type { Action } from "./model";
import { contentWords, phraseAsWritten, sharedPhrase } from "./related";

/**
 * Grouping — the Actions list folded by subject, on demand.
 *
 * A view, not a structure: nothing is written to the board, no group exists
 * as data, and switching the toggle off restores the flat list untouched.
 * The matching rules are related.ts's, verbatim — token-exact content words,
 * shared phrases first — so what groups here is exactly what the Related
 * line would connect.
 *
 * Two actions belong together when they share:
 *
 *   1. a contiguous phrase of content words ("tax return"), or
 *   2. a distinctive word — one carried by at most half the live actions,
 *      so a word that is all over the list ("email") groups nothing.
 *
 * Connections are transitive: A–B and B–C put all three in one group. Each
 * group is named by its strongest shared evidence — the phrase or word that
 * did the most connecting — and only groups of two or more exist; everything
 * else stays in `rest`, in board order, exactly as the flat list shows it.
 */

export type ActionGroup = {
  /** The shared phrase or word that names the group, as a member writes it. */
  label: string;
  /** Two or more actions, in board order (newest first). */
  actions: Action[];
};

export type GroupedActions = {
  /** Ordered by each group's newest action, so recency still reads top-down. */
  groups: ActionGroup[];
  /** Actions that connect to nothing, in board order. */
  rest: Action[];
};

export function groupActions(actions: Action[]): GroupedActions {
  const n = actions.length;
  const words = actions.map((a) => new Set(contentWords(a.text)));

  /* Rarity within the list: a word in more than half the actions links
     everything and means nothing. Floor of 2 so tiny lists can still group. */
  const counts = new Map<string, number>();
  for (const ws of words)
    for (const w of ws) counts.set(w, (counts.get(w) || 0) + 1);
  const maxShare = Math.max(2, Math.floor(n / 2));

  /* Union-find over pairwise connections. */
  const parent = actions.map((_, i) => i);
  const find = (i: number): number =>
    parent[i] === i ? i : (parent[i] = find(parent[i]));
  const union = (i: number, j: number) => {
    parent[find(i)] = find(j);
  };

  /* Each connecting pair casts a vote for the group's name — a phrase vote
     far outweighs a word vote, mirroring related.ts's scoring. */
  const votes: { i: number; label: string; weight: number }[] = [];

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const phrase = sharedPhrase(actions[i].text, actions[j].text);
      let label = "";
      let weight = 0;
      if (phrase) {
        label = phrase;
        weight = 100 + phrase.split(" ").length;
      } else {
        const shared = [...words[i]].filter(
          (w) => words[j].has(w) && (counts.get(w) || 0) <= maxShare
        );
        if (!shared.length) continue;
        /* The most distinctive shared word: fewest sharers, then longest. */
        label = shared.sort(
          (x, y) =>
            (counts.get(x) || 0) - (counts.get(y) || 0) || y.length - x.length
        )[0];
        weight = 1;
      }
      union(i, j);
      votes.push({ i, label, weight });
    }
  }

  /* Tally votes per root and name each group by its heaviest label. */
  const tallies = new Map<number, Map<string, number>>();
  for (const v of votes) {
    const root = find(v.i);
    const t = tallies.get(root) || new Map<string, number>();
    t.set(v.label, (t.get(v.label) || 0) + v.weight);
    tallies.set(root, t);
  }

  const members = new Map<number, Action[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    members.set(root, [...(members.get(root) || []), actions[i]]);
  }

  const groups: ActionGroup[] = [];
  const rest: Action[] = [];
  for (const [root, list] of members) {
    if (list.length < 2) {
      rest.push(...list);
      continue;
    }
    const tally = tallies.get(root) || new Map<string, number>();
    const raw =
      [...tally.entries()].sort(
        (a, b) => b[1] - a[1] || b[0].length - a[0].length
      )[0]?.[0] || "";
    /* Name the group in the user's own words: the content-word run expanded
       back to how a member actually writes it ("step step" → "step-by-step"). */
    let label = raw;
    for (const a of list) {
      const written = phraseAsWritten(raw, a.text);
      if (written !== raw) {
        label = written;
        break;
      }
    }
    groups.push({ label, actions: list });
  }

  /* Groups in board order of their newest member — recency reads top-down
     just as it does flat. */
  const pos = new Map(actions.map((a, i) => [a.id, i]));
  groups.sort(
    (a, b) => (pos.get(a.actions[0].id) || 0) - (pos.get(b.actions[0].id) || 0)
  );

  return { groups, rest };
}
