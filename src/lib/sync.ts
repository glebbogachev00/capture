/**
 * The sync merge — how two devices' boards become one.
 *
 * Everything is matched on id, and every item carries an updatedAt. The rules
 * are deliberately few, and they are what make deletes, edits and moves
 * resolve without either device clobbering the other:
 *
 *  - Adds never conflict: ids are unique, so both sides' new items merge in.
 *  - Edits: the copy with the newer updatedAt wins whole-item.
 *  - Deletes: a tombstone (kind + id + deletedAt) removes an item when its
 *    deletedAt is at least the item's updatedAt. An edit made after the
 *    delete resurrects the item — the newest action wins, nothing is lost
 *    silently.
 *  - Threads merge structurally: thread-level fields by LWW, but fragments
 *    merge per-frag across both sides, so a note added on the phone and one
 *    added on the Mac to the same thread both survive.
 *  - Moves are edits of the frag's home: the moved copy carries a newer
 *    updatedAt, and the merge places the frag in the thread where its newest
 *    copy lives.
 */

import type { Board, Frag, Thread } from "./model";

export type TombstoneKind =
  | "action"
  | "thread"
  | "frag"
  | "intention"
  | "principle";

export type Tombstone = { kind: TombstoneKind; id: string; deletedAt: number };

export type SyncState = { board: Board; tombstones: Tombstone[] };

/** Where this device remembers its deletions, so an offline delete is still
    pushed once the server is reachable again. */
export const TOMBSTONE_KEY = "capture:tombstones:v1";

/** An item's freshness: updatedAt where set, else its creation time. */
const ts = (x: { updatedAt?: number; at?: number }) => x.updatedAt ?? x.at ?? 0;

/** Tombstones merge to the newest deletedAt per kind+id. */
export function mergeTombstones(a: Tombstone[], b: Tombstone[]): Tombstone[] {
  const byKey = new Map<string, Tombstone>();
  for (const t of [...a, ...b]) {
    const key = t.kind + ":" + t.id;
    const cur = byKey.get(key);
    if (!cur || t.deletedAt > cur.deletedAt) byKey.set(key, t);
  }
  return [...byKey.values()];
}

/** Merge one collection by id, LWW on updatedAt. Order: a's items in place,
    then b's newcomers (so each device keeps the ordering it knows). */
function mergeList<T extends { id: string; updatedAt?: number; at?: number }>(
  a: T[],
  b: T[],
  sort?: (x: T, y: T) => number
): T[] {
  const byId = new Map<string, T>();
  for (const x of a) byId.set(x.id, x);
  for (const x of b) {
    const cur = byId.get(x.id);
    if (!cur || ts(x) > ts(cur)) byId.set(x.id, x);
  }
  const out: T[] = [];
  const seen = new Set<string>();
  for (const x of a) {
    const win = byId.get(x.id);
    if (win) {
      out.push(win);
      seen.add(x.id);
    }
  }
  for (const x of b) {
    const win = byId.get(x.id);
    if (win && !seen.has(x.id)) {
      out.push(win);
      seen.add(x.id);
    }
  }
  return sort ? out.sort(sort) : out;
}

/** Threads: fields by LWW, fragments by LWW across BOTH sides. */
function mergeThreads(a: Thread[], b: Thread[]): Thread[] {
  const byId = new Map<string, Thread>();
  for (const t of a) byId.set(t.id, t);
  for (const t of b) {
    const cur = byId.get(t.id);
    if (!cur || ts(t) > ts(cur)) byId.set(t.id, t);
  }

  /* A frag moved on one device (updatedAt bumped on the move) lands in its
     newest home; a frag untouched on both sides simply keeps the newer copy. */
  const frags = new Map<string, { frag: Frag; home: string }>();
  const consider = (threads: Thread[]) => {
    for (const t of threads) {
      for (const f of t.frags) {
        const cur = frags.get(f.id);
        if (!cur || ts(f) > ts(cur.frag)) frags.set(f.id, { frag: f, home: t.id });
      }
    }
  };
  consider(a);
  consider(b);

  const out: Thread[] = [];
  for (const t of byId.values()) {
    const own = [...frags.values()]
      .filter((x) => x.home === t.id)
      .map((x) => x.frag)
      .sort((x, y) => x.at - y.at);
    out.push({ ...t, frags: own });
  }
  return out;
}

/** Merge two boards. Pure and deterministic. */
export function mergeBoards(a: Board, b: Board): Board {
  return {
    actions: mergeList(a.actions, b.actions, (x, y) => y.at - x.at),
    threads: mergeThreads(a.threads, b.threads),
    intentions: mergeList(a.intentions, b.intentions, (x, y) => y.at - x.at),
    principles: mergeList(a.principles, b.principles),
  };
}

/** Remove everything a tombstone has claimed. */
export function applyTombstones(board: Board, tombstones: Tombstone[]): Board {
  const gone = (kind: TombstoneKind, id: string, updatedAt: number) => {
    const tb = tombstones.find((t) => t.kind === kind && t.id === id);
    return !!tb && tb.deletedAt >= updatedAt;
  };
  return {
    actions: board.actions.filter((a) => !gone("action", a.id, ts(a))),
    threads: board.threads
      .filter((t) => !gone("thread", t.id, ts(t)))
      .map((t) => ({
        ...t,
        frags: t.frags.filter((f) => !gone("frag", f.id, ts(f))),
      })),
    intentions: board.intentions.filter((i) => !gone("intention", i.id, ts(i))),
    principles: board.principles.filter((p) => !gone("principle", p.id, ts(p))),
  };
}

/** The full merge: tombstones, then boards, then deletions applied. */
export function mergeSync(a: SyncState, b: SyncState): SyncState {
  const tombstones = mergeTombstones(a.tombstones, b.tombstones);
  const board = applyTombstones(mergeBoards(a.board, b.board), tombstones);
  return { board, tombstones };
}

/**
 * The local side of a commit: turn one board into another while recording
 * what the change means for sync.
 *
 *  - New items get an updatedAt so the very first merge can compare them.
 *  - Items whose content changed get updatedAt = now (LWW fuel).
 *  - Fragments whose HOME changed (a move) are stamped too, so the merge
 *    places them in the thread where their newest copy lives.
 *  - Anything that left the board becomes a tombstone, so the deletion can
 *    travel to the other device instead of resurrecting on its next pull.
 *
 * Pure and deterministic; callers fold the tombstones into their own list.
 */
export function stampChanges(
  prev: Board,
  next: Board,
  now = Date.now()
): { board: Board; tombstones: Tombstone[] } {
  const tombstones: Tombstone[] = [];
  const stamp = <T extends { updatedAt?: number }>(x: T): T => ({
    ...x,
    updatedAt: now,
  });
  const fresh = <T extends { updatedAt?: number; at?: number }>(x: T): T => ({
    ...x,
    updatedAt: x.updatedAt ?? x.at ?? now,
  });
  const same = <T>(a: T, b: T) => JSON.stringify(a) === JSON.stringify(b);

  /* Actions. */
  const actions = next.actions.map((a) => {
    const p = prev.actions.find((x) => x.id === a.id);
    if (!p) return fresh(a);
    return same(p, a) ? a : stamp(a);
  });
  for (const a of prev.actions)
    if (!next.actions.some((x) => x.id === a.id))
      tombstones.push({ kind: "action", id: a.id, deletedAt: now });

  /* Intentions. */
  const intentions = next.intentions.map((i) => {
    const p = prev.intentions.find((x) => x.id === i.id);
    if (!p) return fresh(i);
    return same(p, i) ? i : stamp(i);
  });
  for (const i of prev.intentions)
    if (!next.intentions.some((x) => x.id === i.id))
      tombstones.push({ kind: "intention", id: i.id, deletedAt: now });

  /* Principles. */
  const principles = next.principles.map((p) => {
    const q = prev.principles.find((x) => x.id === p.id);
    if (!q) return fresh(p);
    return same(q, p) ? p : stamp(p);
  });
  for (const p of prev.principles)
    if (!next.principles.some((x) => x.id === p.id))
      tombstones.push({ kind: "principle", id: p.id, deletedAt: now });

  /* Threads. Fragment homes first, so a move with unchanged text still
     stamps the moved fragment (its newest copy decides its thread). */
  const prevFragHome = new Map<string, string>();
  for (const t of prev.threads) for (const f of t.frags) prevFragHome.set(f.id, t.id);
  const nextFragHome = new Map<string, string>();
  for (const t of next.threads) for (const f of t.frags) nextFragHome.set(f.id, t.id);

  const threads = next.threads.map((t) => {
    const p = prev.threads.find((x) => x.id === t.id);
    let changed = !p;
    const frags = t.frags.map((f) => {
      const pf = p?.frags.find((x) => x.id === f.id);
      if (!pf) {
        changed = true;
        return fresh(f);
      }
      if (prevFragHome.get(f.id) !== nextFragHome.get(f.id)) {
        changed = true;
        return stamp(f);
      }
      if (same(pf, f)) return f;
      changed = true;
      return stamp(f);
    });
    if (!changed) return t;
    return { ...t, frags, updatedAt: now };
  });

  for (const t of prev.threads)
    if (!next.threads.some((x) => x.id === t.id)) {
      tombstones.push({ kind: "thread", id: t.id, deletedAt: now });
      for (const f of t.frags)
        tombstones.push({ kind: "frag", id: f.id, deletedAt: now });
    }
  for (const f of prevFragHome.keys())
    if (!nextFragHome.has(f))
      tombstones.push({ kind: "frag", id: f, deletedAt: now });

  return { board: { actions, threads, intentions, principles }, tombstones };
}
