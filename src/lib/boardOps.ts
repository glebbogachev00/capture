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
import { expiryFor, parseDue } from "./due";
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
import { bestActionDuplicate } from "./related";

/** What /api/sort returns. Validated server-side against a schema. */
export type SortResult = {
  clean: string;
  kind: "action" | "thread" | "intention" | "both";
  title: string;
  actions?: string[];
  shelfLife?: string;
  /** An ISO deadline the capture named for itself, or null. */
  due?: string | null;
  threadId?: string | null;
  threadName?: string | null;
  /** When the capture is split, the part that stays with the primary
      destination. `clean` remains the whole capture, because the ledger and
      Undo are written around it. */
  primaryText?: string | null;
  /** Further threads this capture also belongs in, each carrying only its
      own share of the words. Empty for the ordinary one-subject capture. */
  also?:
    | { text: string; threadId?: string | null; threadName?: string | null }[]
    | null;
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
  /** Where each further subject went, so the caller can record one ledger
      entry per destination. The ledger is what Undo and the daily wrap read
      from, so a fragment with no entry is a fragment they cannot see. */
  alsoLanded?: { threadId: string; fragId: string; text: string }[];
};

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/**
 * Fold a sorted capture into a board, returning the new board plus what it
 * landed as. `at` is the capture's timestamp; images are already stored by id.
 */
/**
 * Apply a sorted capture, including any further subjects it holds.
 *
 * One breath is often about two things. The primary destination is decided
 * exactly as it always was — so the banner, the ledger entry and the
 * misfiled question all still have the single target they are written
 * around — and each further subject is folded in afterwards as a fragment
 * carrying only its own share of the words.
 *
 * Undo needed no changes: it reverts by `addedIds`, which is a diff of the
 * whole board, so it already takes back everything a capture created
 * however many places it touched.
 */
export function applySorted(
  out: SortResult,
  imgIds: string[],
  at: number,
  board: Board
): Applied {
  /* Split captures file their own share in the primary thread, not the whole
     capture — otherwise the half that went to `also` is sitting in two
     places and the person has to notice the copy and delete it. `clean`
     itself is untouched: the ledger records what was actually said. */
  /* A split is only safe when the model said what stays behind. Without
     `primaryText` there is no way to know which words belong to the primary,
     and filing the whole capture plus a copy of half of it is worse than not
     splitting at all: the person has to spot the duplicate and delete it.
     So an unusable split is refused outright rather than half-applied. */
  const pieces = (out.also ?? []).filter((p) => p?.text?.trim());
  const share = out.primaryText?.trim();
  const splitting = pieces.length > 0 && !!share;
  const sorted = splitting ? { ...out, clean: share! } : out;
  const primary = applyPrimary(sorted, imgIds, at, board);
  return splitting ? foldAlso(primary, pieces, at, board) : primary;
}

type Piece = NonNullable<SortResult["also"]>[number];

/** Add each further subject to its thread, opening one where none was named. */
function foldAlso(
  applied: Applied,
  pieces: Piece[],
  at: number,
  original: Board
): Applied {
  let board = applied.next;
  const alsoLanded: Applied["alsoLanded"] = [];
  const landedIds = [...applied.landedIds];
  const names: string[] = [];

  for (const piece of pieces) {
    const frag: Frag = { id: uid(), at, text: piece.text.trim(), imgs: [] };
    landedIds.push(frag.id);
    const home = piece.threadId
      ? board.threads.find((t) => t.id === piece.threadId)
      : undefined;
    if (home) {
      names.push(home.name);
      alsoLanded.push({ threadId: home.id, fragId: frag.id, text: frag.text });
      board = {
        ...board,
        threads: board.threads.map((t) =>
          t.id === home.id ? { ...t, frags: [...t.frags, frag] } : t
        ),
      };
      continue;
    }
    /* No thread named, or one that no longer exists: open a new one rather
       than drop the words. */
    const fresh: Thread = {
      id: uid(),
      name: piece.threadName || frag.text.slice(0, 40),
      summary: "",
      frags: [frag],
    };
    names.push(fresh.name);
    landedIds.push(fresh.id);
    alsoLanded.push({ threadId: fresh.id, fragId: frag.id, text: frag.text });
    board = { ...board, threads: [fresh, ...board.threads] };
  }

  void original;
  return {
    ...applied,
    next: board,
    landedIds,
    alsoLanded,
    /* The banner names every place it went, because "landed somewhere" is
       exactly the doubt a split creates. */
    landed: applied.landed + names.map((n) => " · " + n).join(""),
  };
}

function applyPrimary(
  out: SortResult,
  imgIds: string[],
  at: number,
  board: Board
): Applied {
  if (out.kind === "action") {
    const span = SHELF[out.shelfLife as ShelfLife] ?? null;
    const due = parseDue(out.due, stamp());

    /* A picture that arrives with a task has nowhere to live on an action:
       nothing renders an action's images, and ticking the action off would
       take the picture with it. So the capture lands in both places — the
       image on a thread fragment that keeps it, the task as an action that
       points at it. The thread the sorter named is preferred; otherwise the
       capture opens one, because a screenshot with no home is a screenshot
       you will never see again. */
    const shotFrag: Frag | null = imgIds.length
      ? { id: uid(), at, text: out.clean, imgs: imgIds }
      : null;
    const shotHome = shotFrag
      ? board.threads.find((x) => x.id === out.threadId)
      : undefined;
    const threads: Thread[] = !shotFrag
      ? board.threads
      : shotHome
        ? board.threads.map((x) =>
            x.id === shotHome.id ? { ...x, frags: [...x.frags, shotFrag] } : x
          )
        : [
            {
              id: uid(),
              name: out.threadName || out.title,
              summary: "",
              frags: [shotFrag],
            } as Thread,
            ...board.threads,
          ];
    const shotThreadId = shotFrag
      ? shotHome
        ? shotHome.id
        : threads[0].id
      : null;

    const items: Action[] = (out.actions?.length ? out.actions : [out.title]).map(
      (t: string) => ({
        id: uid(),
        text: t,
        done: false,
        at,
        src: out.clean,
        /* Never the action's own: the fragment owns the picture. */
        imgs: [],
        ...(shotFrag && shotThreadId
          ? { shot: { threadId: shotThreadId, fragId: shotFrag.id } }
          : {}),
        shelf: (out.shelfLife || "keep") as ShelfLife,
        /* A stated deadline never lets the action fade before its date. */
        due,
        expires: expiryFor(span, due, stamp()),
      })
    );
    const plain =
      items.length +
      " action" +
      (items.length > 1 ? "s" : "") +
      (span ? " · fades in " + left(span) : " · kept");
    return {
      next: { ...board, actions: [...items, ...board.actions], threads },
      targetId: shotThreadId,
      /* A single action can fold into a thread; several cannot, so only a
         lone action is ever offered a home. An action whose picture already
         sits in a thread is not offered one — it has a home. */
      source:
        items.length === 1 && !shotFrag
          ? { kind: "action", id: items[0].id }
          : null,
      landedIds: shotThreadId
        ? [...items.map((i) => i.id), shotThreadId]
        : items.map((i) => i.id),
      landed: shotFrag
        ? plain +
          " · picture kept in " +
          (shotHome ? shotHome.name : threads[0].name)
        : plain,
    };
  }

  // "both": the capture holds a task to close AND thinking to keep. The
  // thinking goes to a thread (its durable home, so images ride with the
  // fragment) and the task(s) become actions with no images of their own —
  // deleting a closed action must never drop an image the thread still uses.
  if (out.kind === "both") {
    const span = SHELF[out.shelfLife as ShelfLife] ?? null;
    const due = parseDue(out.due, stamp());
    const items: Action[] = (out.actions ?? []).map((t) => ({
      id: uid(),
      text: t,
      done: false,
      at,
      src: out.clean,
      imgs: [],
      shelf: (out.shelfLife || "keep") as ShelfLife,
      due,
      expires: expiryFor(span, due, stamp()),
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
    /* The action and the layer are two halves of one capture; the action
       remembers which thread holds the other half. */
    const linked = items.map((i) => ({ ...i, threadId: homeId }));
    return {
      next: { ...board, actions: [...linked, ...board.actions], threads },
      targetId: homeId,
      source: { kind: "thread", id: homeId, fragId: bothFrag.id },
      landedIds: [...linked.map((i) => i.id), homeId],
      /* A layer is something added to a thread that was already there. A
         thread this capture just created has no layers yet — calling its
         first fragment "a layer on X" describes a history that does not
         exist, and reads as though the capture joined something. */
      landed:
        count(items.length, "action") +
        (home ? " · a layer on " + homeName : " · a new thread — " + homeName),
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
      landed: existing.name + " · a new layer",
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
    landed: fresh.name + " · a new thread",
  };
}

/** When a thread was last added to. Threads with no fragments yet fall back
    to their own stamp, so a freshly made one still sorts sanely. */
export function lastTouched(t: Thread): number {
  return t.frags.at(-1)?.at ?? t.updatedAt ?? 0;
}

/**
 * Threads, most recently added-to first.
 *
 * The list used to be ordered by creation: a new thread went to the front
 * and then never moved again, however much you fed it. So the subject you
 * added to this morning could sit below one you started months ago and
 * abandoned. Recency is what you want essentially always, which is why this
 * is the order rather than a control to choose it.
 */
export function byRecency(a: Thread, b: Thread): number {
  return lastTouched(b) - lastTouched(a);
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
    const dup = bestActionDuplicate(board, text, source.id, 3);
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
  /* No fragment-duplicate offers, and no home offers — both by decision.

     Home offers (2026-09-01): a filing suggestion built on a shared phrase
     is a string match second-guessing a model that saw the whole board —
     "it doesn't help make any decision that improves capture, it just
     matches words." Restricted, then judged, it kept being wrong; gone.

     Fragment duplicates (2026-09-02, caught on camera the same day the
     looks_done flow shipped): "the undo button is in and working now"
     was flagged as a duplicate of "I want an undo button", reason 'both
     mention "undo button edit wording"'. Word coverage cannot tell a
     note about DOING a thing from a note that the thing IS DONE — they
     share every content word — and completion notes are now a first-class
     flow. Real note duplicates are the model's to claim (Tidy's
     dup_fragment), because it can tell those apart.

     The action duplicate above stays: re-capturing a task produces two
     imperatives, which is the one shape word coverage judges fairly. */
  return null;
}
