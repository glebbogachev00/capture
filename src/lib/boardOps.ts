/**
 * Pure board transformations, lifted out of useBoard so the logic that shapes
 * the board can be read and tested without a React runtime. Nothing here
 * touches state, refs, or the network: a board goes in, a new board comes out.
 *
 * `applySorted` is the first tenant. It is where a capture becomes items on the
 * board, and the kind of place a structural bug hides (the merge data-loss bug
 * was this shape of logic), so it earns direct unit tests.
 */

import { stamp } from "./clock";
import {
  type Action,
  type Board,
  type Frag,
  type ShelfLife,
  type Thread,
  SHELF,
  left,
  uid,
} from "./model";
import {
  bestActionDuplicate,
  bestFragmentDuplicate,
  bestThreadHome,
} from "./related";

/** What /api/sort returns. Validated server-side against a schema. */
export type SortResult = {
  clean: string;
  kind: "action" | "thread" | "intention" | "both";
  title: string;
  actions?: string[];
  shelfLife?: string;
  threadId?: string | null;
  threadName?: string | null;
  /** Which model tier sorted it — recorded in the capture ledger. */
  via?: string;
};

/** What a capture just landed as — the thing a suggestion would act on. */
export type LandedSource = {
  kind: "action" | "thread";
  /** The landed fragment inside the thread (a thread that already existed);
      absent when the thread was just created, so the whole thread folds. */
  id: string;
  fragId?: string;
};

export type Applied = {
  next: Board;
  targetId: string | null;
  landed: string;
  source: LandedSource | null;
  /** Ids of everything this capture just created — the rows and cards the
      UI washes with the landed glow, so you see WHERE it went and not only
      that it went somewhere. Actions by action id, threads by thread id. */
  landedIds: string[];
};

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/**
 * Fold a sorted capture into a board, returning the new board plus what it
 * landed as. `at` is the capture's timestamp; images are already stored by id.
 */
export function applySorted(
  out: SortResult,
  imgIds: string[],
  at: number,
  board: Board
): Applied {
  if (out.kind === "action") {
    const span = SHELF[out.shelfLife as ShelfLife] ?? null;
    const items: Action[] = (out.actions?.length ? out.actions : [out.title]).map(
      (t: string) => ({
        id: uid(),
        text: t,
        done: false,
        at,
        src: out.clean,
        imgs: imgIds,
        shelf: (out.shelfLife || "keep") as ShelfLife,
        expires: span ? stamp() + span : null,
      })
    );
    return {
      next: { ...board, actions: [...items, ...board.actions] },
      targetId: null,
      /* A single action can fold into a thread; several cannot, so only a
         lone action is ever offered a home. */
      source: items.length === 1 ? { kind: "action", id: items[0].id } : null,
      landedIds: items.map((i) => i.id),
      landed:
        items.length +
        " action" +
        (items.length > 1 ? "s" : "") +
        (span ? " · fades in " + left(span) : " · kept"),
    };
  }

  // "both": the capture holds a task to close AND thinking to keep. The
  // thinking goes to a thread (its durable home, so images ride with the
  // fragment) and the task(s) become actions with no images of their own —
  // deleting a closed action must never drop an image the thread still uses.
  if (out.kind === "both") {
    const span = SHELF[out.shelfLife as ShelfLife] ?? null;
    const items: Action[] = (out.actions ?? []).map((t) => ({
      id: uid(),
      text: t,
      done: false,
      at,
      src: out.clean,
      imgs: [],
      shelf: (out.shelfLife || "keep") as ShelfLife,
      expires: span ? stamp() + span : null,
    }));
    const bothFrag: Frag = { id: uid(), at, text: out.clean, imgs: imgIds };
    const home = board.threads.find((x) => x.id === out.threadId);
    const threads = home
      ? board.threads.map((x) =>
          x.id === home.id ? { ...x, frags: [...x.frags, bothFrag] } : x
        )
      : [
          {
            id: uid(),
            name: out.threadName || out.title,
            summary: "",
            frags: [bothFrag],
          } as Thread,
          ...board.threads,
        ];
    const homeId = home ? home.id : threads[0].id;
    const homeName = home ? home.name : threads[0].name;
    return {
      next: { ...board, actions: [...items, ...board.actions], threads },
      targetId: homeId,
      source: { kind: "thread", id: homeId, fragId: bothFrag.id },
      landedIds: [...items.map((i) => i.id), homeId],
      landed: count(items.length, "action") + " + thread — " + homeName,
    };
  }

  const frag: Frag = { id: uid(), at, text: out.clean, imgs: imgIds };
  const existing = board.threads.find((x) => x.id === out.threadId);
  if (existing) {
    return {
      next: {
        ...board,
        threads: board.threads.map((x) =>
          x.id === existing.id ? { ...x, frags: [...x.frags, frag] } : x
        ),
      },
      targetId: existing.id,
      source: { kind: "thread", id: existing.id, fragId: frag.id },
      landedIds: [existing.id],
      landed: existing.name + " — thread updated",
    };
  }
  const fresh: Thread = {
    id: uid(),
    name: out.threadName || out.title,
    summary: "",
    frags: [frag],
  };
  return {
    next: { ...board, threads: [fresh, ...board.threads] },
    targetId: fresh.id,
    source: { kind: "thread", id: fresh.id, fragId: frag.id },
    landedIds: [fresh.id],
    landed: fresh.name + " — thread updated",
  };
}

/**
 * A quiet post-capture proposal — never applied; the user confirms or
 * dismisses it. One tap either way.
 *
 * "home": the capture clearly belongs with an existing thread. Merge when a
 *   fresh thread folds in, Move when a fragment or a captured action moves over.
 * "duplicate": a captured action or note is the same task/note as an existing
 *   one. The copy that just landed is removed; the original stays. For a note,
 *   sourceFragId names the fragment to drop.
 */
export type Suggestion =
  | {
      kind: "home";
      targetId: string;
      targetName: string;
      reason: string;
      sourceKind: "action" | "thread";
      sourceId: string;
      fragId?: string;
      verb: "Merge" | "Move";
    }
  | {
      kind: "duplicate";
      targetId: string;
      targetName: string;
      reason: string;
      sourceId: string;
      sourceKind: "action" | "thread";
      sourceFragId?: string;
    };

/**
 * Given what a capture just landed as, propose the one quiet follow-up worth
 * offering: it duplicates something already here, or it clearly belongs with an
 * existing thread. Deterministic and local — no model, no state. Returns null
 * when nothing is worth suggesting.
 */
export function computeSuggestion(
  board: Board,
  text: string,
  source: LandedSource | null
): Suggestion | null {
  if (!source || !text.trim()) return null;
  if (source.kind === "action") {
    /* The engine is handed the source id so the capture's own text — which it
       always phrase-matches, and which sits at the front of the list — is never
       reported as its own duplicate. The counterpart must also be live:
       re-capturing a task that is already fading away is a refresh, not a
       duplicate. */
    const dup = bestActionDuplicate(board, text, source.id);
    const dupLive = dup && !board.actions.find((a) => a.id === dup.id)?.faded;
    if (dup && dupLive) {
      return {
        kind: "duplicate",
        targetId: dup.id,
        targetName: dup.name,
        reason: dup.reason,
        sourceId: source.id,
        sourceKind: "action",
      };
    }
  }
  /* A capture that landed as a note can still duplicate a note already on the
     board — the same thing pasted twice lands as two fragments. The fragment
     duplicate beats the thread home: if it is the same note again, offer to
     drop the copy instead of merging it in silently. The engine excludes the
     just-landed fragment itself, which always phrase-matches its own text. */
  if (source.kind === "thread") {
    const fragDup = bestFragmentDuplicate(board, text, source.fragId);
    if (fragDup) {
      const crossThread = source.fragId && fragDup.threadId !== source.id;
      return {
        kind: "duplicate",
        targetId: fragDup.threadId,
        targetName:
          fragDup.name + (crossThread ? ` (in "${fragDup.threadName}")` : ""),
        reason: fragDup.reason,
        sourceKind: "thread",
        sourceId: source.id,
        sourceFragId: source.fragId,
      };
    }
  }
  const hit = bestThreadHome(board, text, source.id);
  if (!hit) return null;
  if (source.kind === "action") {
    return {
      kind: "home",
      targetId: hit.id,
      targetName: hit.name,
      reason: hit.reason,
      sourceKind: "action",
      sourceId: source.id,
      verb: "Move",
    };
  }
  return source.fragId
    ? {
        kind: "home",
        targetId: hit.id,
        targetName: hit.name,
        reason: hit.reason,
        sourceKind: "thread",
        sourceId: source.id,
        fragId: source.fragId,
        verb: "Move",
      }
    : {
        kind: "home",
        targetId: hit.id,
        targetName: hit.name,
        reason: hit.reason,
        sourceKind: "thread",
        sourceId: source.id,
        verb: "Merge",
      };
}
