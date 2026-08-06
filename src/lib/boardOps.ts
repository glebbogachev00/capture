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
    landed: fresh.name + " — thread updated",
  };
}
