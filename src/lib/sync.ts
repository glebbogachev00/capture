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
import { mergeCorrections, mergeLedgers } from "./ledger";
import { mergeWraps, mergeCompletions } from "./wrap";

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

/** How long a deletion is remembered. A tombstone's whole job is to reach
    the other device before an old copy resurrects the item; a device that
    hasn't synced in a month is restoring from another era anyway. Without
    a horizon, every deletion ever made rides every sync forever — measured
    at nearly half the payload on a small board. */
export const TOMBSTONE_TTL = 30 * 24 * 60 * 60 * 1000;

/** Tombstones merge to the newest deletedAt per kind+id; ancient ones age
    out (see TOMBSTONE_TTL). `now` is injectable for tests. */
export function mergeTombstones(
  a: Tombstone[],
  b: Tombstone[],
  now = Date.now()
): Tombstone[] {
  const byKey = new Map<string, Tombstone>();
  for (const t of [...a, ...b]) {
    if (now - t.deletedAt > TOMBSTONE_TTL) continue;
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
  /* History is union-merged, so the only way to start it over is an epoch:
     the side that was started over later wins, and the other side's
     history is dropped rather than merged back in. */
  const ea = a.historyEpoch ?? 0;
  const eb = b.historyEpoch ?? 0;
  const empty = { ledger: [], corrections: [], wraps: [], completions: [] };
  const ha = ea >= eb ? a : empty;
  const hb = eb >= ea ? b : empty;
  return {
    historyEpoch: Math.max(ea, eb),
    actions: mergeList(a.actions, b.actions, (x, y) => y.at - x.at),
    threads: mergeThreads(a.threads, b.threads),
    intentions: mergeList(a.intentions, b.intentions, (x, y) => y.at - x.at),
    principles: mergeList(a.principles, b.principles),
    /* Ledger entries never change, so the merge is a plain union. The `??`
       guards boards built before the field existed. */
    ledger: mergeLedgers(ha.ledger ?? [], hb.ledger ?? []),
    /* Same for corrections — append-only records, union by id. */
    corrections: mergeCorrections(ha.corrections ?? [], hb.corrections ?? []),
    /* Wraps are union by day; a dismissal on one device carries. */
    wraps: mergeWraps(ha.wraps ?? [], hb.wraps ?? []),
    /* Ticks are union by action id — recorded once, never changed. */
    completions: mergeCompletions(ha.completions ?? [], hb.completions ?? []),
  };
}

/** Remove everything a tombstone has claimed. Indexed once up front: this
    runs on every pull, and a linear scan per item made it O(items × stones). */
export function applyTombstones(board: Board, tombstones: Tombstone[]): Board {
  const byKey = new Map<string, Tombstone>();
  for (const t of tombstones) byKey.set(t.kind + ":" + t.id, t);
  const gone = (kind: TombstoneKind, id: string, updatedAt: number) => {
    const tb = byKey.get(kind + ":" + id);
    return !!tb && tb.deletedAt >= updatedAt;
  };
  return {
    ...board,
    actions: board.actions.filter((a) => !gone("action", a.id, ts(a))),
    threads: board.threads
      .filter((t) => !gone("thread", t.id, ts(t)))
      .map((t) => ({
        ...t,
        frags: t.frags.filter((f) => !gone("frag", f.id, ts(f))),
      })),
    intentions: board.intentions.filter((i) => !gone("intention", i.id, ts(i))),
    principles: board.principles.filter((p) => !gone("principle", p.id, ts(p))),
    /* Tombstones claim items, never history — the ledgers ride through. */
    ledger: board.ledger,
    corrections: board.corrections,
    wraps: board.wraps,
    completions: board.completions,
  };
}

/**
 * A stable fingerprint of everything sync cares about: which items exist,
 * how fresh each one is, and where each fragment lives.
 *
 * This is what a pull compares before adopting a merge. The obvious cheap
 * test — "is the newest timestamp newer than mine?" — is WRONG, and lost
 * real edits: a device holding anything more recent than the incoming
 * change (a capture made a minute later, say) sees an unchanged maximum
 * and throws the merge away, so the other device's edit never lands.
 *
 * Order-independent (the parts are sorted) so a merge that merely rebuilds
 * objects or re-sorts fragments does not read as a change.
 */
/**
 * A cheap order-independent fingerprint of a list of ids.
 *
 * FNV-1a over each id, summed, so the result does not depend on the order
 * the lists happen to be in after a merge. Thirty-two bits is ample here:
 * this decides whether to re-render a board that just merged, and the cost
 * of a collision is one skipped adoption, not lost data.
 */
function hashOf(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

function idsOf(items: { id: string }[]): string {
  let acc = 0;
  for (const it of items) acc = (acc + parseInt(hashOf(it.id), 36)) >>> 0;
  return acc.toString(36);
}

export function boardSignature(board: Board, tombstones: Tombstone[]): string {
  const parts: string[] = [];
  for (const a of board.actions) parts.push(`a:${a.id}:${ts(a)}`);
  for (const t of board.threads) {
    parts.push(`t:${t.id}:${t.updatedAt ?? 0}`);
    /* The thread id rides along, so moving a fragment between threads is a
       change even when its own timestamp is untouched. */
    for (const f of t.frags) parts.push(`f:${t.id}:${f.id}:${ts(f)}`);
  }
  for (const i of board.intentions) parts.push(`i:${i.id}:${ts(i)}`);
  for (const p of board.principles) parts.push(`p:${p.id}:${p.updatedAt ?? 0}`);
  for (const tb of tombstones) parts.push(`x:${tb.kind}:${tb.id}:${tb.deletedAt}`);

  /* History counts as change. It did not, and the omission was invisible
     precisely because history is the part no screen shows: a wrap written
     on the phone, a capture undone on the laptop, or a ticked action moved
     the hub without moving this signature, so the pull merged correctly and
     was then thrown away by the adoption gate below it.

     Each list contributes its length and a hash of its ids rather than the
     ids themselves, because this runs on every poll and the ledger holds up
     to LEDGER_CAP entries — a signature that pasted them all in would be
     rebuilt, sorted and compared every ten seconds.

     Length alone was not enough and the reason is worth keeping: the ledger
     is capped, so once it is full a merged entry pushes the oldest out and
     the count never moves. Naming only the newest id did not save it either
     — an entry merged in from another device is usually older than the
     newest, so both the length and the newest id can match while the
     contents differ. The hash sees the difference wherever it falls.

     The rest are named directly: undone ids, the one field of a ledger entry
     that mutates; each wrap by day and seen, the only mutable history
     record; and the epoch, which is how history is deliberately discarded. */
  const led = board.ledger ?? [];
  parts.push(`L:${led.length}:${idsOf(led)}`);
  for (const e of led) if (e.undone) parts.push(`Lu:${e.id}`);
  const cor = board.corrections ?? [];
  parts.push(`C:${cor.length}:${idsOf(cor)}`);
  const done = board.completions ?? [];
  parts.push(`K:${done.length}:${idsOf(done)}`);
  /* A wrap needs its CONTENT here, not just its day. Two devices offline
     overnight each write their own reading of the same day; the merge picks
     a winner deterministically, and if the signature only said "there is a
     wrap for the 27th, unread" it read the same before and after — so the
     gate below discarded the wrap the merge had just chosen, and the two
     devices stayed disagreeing forever. `at` and the line are exactly what
     the merge decides on, so they are what has to be visible here. */
  for (const w of board.wraps ?? [])
    parts.push(`W:${w.day}:${w.at}:${w.seen ? 1 : 0}:${hashOf(w.line ?? "")}`);
  parts.push(`E:${board.historyEpoch ?? 0}`);

  return parts.sort().join("|");
}

/** The full merge: tombstones, then boards, then deletions applied.
    `now` feeds the tombstone horizon and is injectable for tests. */
export function mergeSync(a: SyncState, b: SyncState, now = Date.now()): SyncState {
  const tombstones = mergeTombstones(a.tombstones, b.tombstones, now);
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
    /* A thread's OWN fields are content too. Only the fragments used to
       count here, so a regenerated summary, a rename, or a cover picked on
       the phone left updatedAt untouched — and the merge, which chooses a
       thread record by updatedAt, then kept the other device's older copy
       and pushed the stale one straight back on the next sync. Two bugs
       were this one line: a summary that kept describing a note the user
       had deleted, and a photo cover set on the phone that never reached
       the laptop. */
    if (
      p &&
      (p.name !== t.name ||
        p.summary !== t.summary ||
        p.cover !== t.cover ||
        (p.next ?? null) !== (t.next ?? null) ||
        p.nextDismissed !== t.nextDismissed)
    )
      changed = true;
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
    /* A thread that LOST a fragment changed as surely as one that gained
       it — the pass above only ever sees the fragments that remain. */
    if (p && p.frags.length !== t.frags.length) changed = true;
    if (!changed) return t;
    return { ...t, frags, updatedAt: now };
  });

  for (const t of prev.threads)
    if (!next.threads.some((x) => x.id === t.id))
      tombstones.push({ kind: "thread", id: t.id, deletedAt: now });

  /* A fragment gets a tombstone only when it left the board entirely. One that
     merely moved to another thread — a merge folds a thread's fragments into
     its target — is still present under nextFragHome, so it is deliberately
     spared. Tombstoning every fragment of a removed thread was the merge
     data-loss bug: the moved copy and its tombstone shared `now`, and
     applyTombstones (deletedAt >= updatedAt) then deleted the survivor. */
  for (const f of prevFragHome.keys())
    if (!nextFragHome.has(f))
      tombstones.push({ kind: "frag", id: f, deletedAt: now });

  return {
    board: {
      ...next,
      actions,
      threads,
      intentions,
      principles,
      ledger: next.ledger,
      corrections: next.corrections,
      wraps: next.wraps,
      completions: next.completions,
    },
    tombstones,
  };
}
