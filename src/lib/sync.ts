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

import type { Board, Frag, RoutingRetirement, RoutingSettlement, Thread } from "./model";
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
/** Manual routing retirement follows the same supported stale-device horizon
 * as ordinary deletion tombstones, and refreshes only when authority or an
 * actual stale loser is observed. */
export const ROUTING_RETIREMENT_TTL = TOMBSTONE_TTL;

const routingSlot = (value: Pick<RoutingRetirement, "captureId" | "pendingId" | "revision">) =>
  JSON.stringify([value.captureId, value.pendingId, value.revision]);

function safeRoutingRetirement(value: unknown): value is RoutingRetirement {
  if (!value || typeof value !== "object") return false;
  const retirement = value as Partial<RoutingRetirement>;
  return safeAuthorityCoordinate(retirement.captureId) &&
    safeAuthorityCoordinate(retirement.pendingId) &&
    Number.isSafeInteger(retirement.revision) && retirement.revision! > 0 &&
    typeof retirement.retiredAt === "number" && Number.isFinite(retirement.retiredAt) &&
    retirement.retiredAt >= 0;
}

function mergeRoutingRetirements(
  a: readonly RoutingRetirement[],
  b: readonly RoutingRetirement[],
  now?: number,
): RoutingRetirement[] {
  const bySlot = new Map<string, RoutingRetirement>();
  for (const retirement of [...a, ...b]) {
    if (!safeRoutingRetirement(retirement)) continue;
    if (now !== undefined && now - retirement.retiredAt > ROUTING_RETIREMENT_TTL) continue;
    const key = routingSlot(retirement);
    const current = bySlot.get(key);
    if (!current || retirement.retiredAt > current.retiredAt) bySlot.set(key, retirement);
  }
  return [...bySlot.values()];
}

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
     newest home. Equal-timestamp conflicts have no LWW winner, so keep every
     distinct maximal copy: collapsing one here would manufacture a unique
     home for Action-shot repair and would discard conflict evidence on the
     next sync. Exact duplicate copies still coalesce. */
  type FragCandidate = { frag: Frag; home: string };
  const conflictKey = ({ frag, home }: FragCandidate) =>
    JSON.stringify([
      home,
      frag.id,
      frag.at,
      frag.text,
      frag.imgs ?? null,
      frag.unsorted ?? null,
      frag.resolvedAt ?? null,
      frag.updatedAt ?? null,
    ]);
  const frags = new Map<
    string,
    { timestamp: number; candidates: Map<string, FragCandidate> }
  >();
  const consider = (threads: Thread[]) => {
    for (const t of threads) {
      for (const f of t.frags) {
        const candidate = { frag: f, home: t.id };
        const timestamp = ts(f);
        const cur = frags.get(f.id);
        if (!cur || timestamp > cur.timestamp) {
          frags.set(f.id, {
            timestamp,
            candidates: new Map([[conflictKey(candidate), candidate]]),
          });
        } else if (timestamp === cur.timestamp) {
          cur.candidates.set(conflictKey(candidate), candidate);
        }
      }
    }
  };
  consider(a);
  consider(b);

  const candidates = [...frags.values()].flatMap((entry) =>
    [...entry.candidates.values()]
  );
  const out: Thread[] = [];
  for (const t of byId.values()) {
    const own = candidates
      .filter((x) => x.home === t.id)
      .map((x) => x.frag)
      .sort((x, y) => x.at - y.at || conflictKey({ frag: x, home: t.id })
        .localeCompare(conflictKey({ frag: y, home: t.id })));
    out.push({ ...t, frags: own });
  }
  return out;
}

/**
 * Repair only the denormalized home in an Action's image pointer. A fragment
 * id is the durable identity; its Thread is mutable when notes move, split, or
 * are folded together. Action rows still merge whole-item by LWW, so a newer
 * edit from a stale device can otherwise restore an obsolete Thread id after
 * the fragment itself has already converged in its new home.
 *
 * Missing and multiple maximal homes fail closed: keep the original pointer
 * rather than inventing a home. The repair changes neither Action freshness
 * nor fragment/history/image data.
 */
export function reconcileActionShotHomes(board: Board): Board {
  const homes = collectFragHomes(board.threads);
  let changed = false;
  const actions = board.actions.map((action) => {
    if (action.done || !action.shot) return action;
    const candidates = homes.get(action.shot.fragId);
    if (!candidates || candidates.size !== 1) return action;
    const [home] = candidates;
    if (home === action.shot.threadId) return action;
    changed = true;
    return {
      ...action,
      shot: { ...action.shot, threadId: home },
    };
  });
  return changed ? { ...board, actions } : board;
}

function settlementArtifactCount(
  board: Pick<Board, "actions" | "threads" | "intentions">,
  artifact: RoutingSettlement["artifacts"][number],
) {
  return artifact.kind === "action"
    ? board.actions.filter((action) => action.id === artifact.id).length
    : artifact.kind === "thread"
      ? board.threads.filter((thread) => thread.id === artifact.id).length
      : artifact.kind === "frag"
        ? board.threads.reduce(
            (count, thread) => count + thread.frags.filter((frag) => frag.id === artifact.id).length,
            0,
          )
        : board.intentions.filter((intention) => intention.id === artifact.id).length;
}

function settlementArtifactExists(
  board: Pick<Board, "actions" | "threads" | "intentions">,
  artifact: RoutingSettlement["artifacts"][number],
) {
  return settlementArtifactCount(board, artifact) > 0;
}

const safeAuthorityCoordinate = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0 &&
  !/[\u0000-\u001f\u007f]/.test(value);

function provenRoutingSettlement(board: Board, value: unknown): value is RoutingSettlement {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<RoutingSettlement>;
  if (
    !safeAuthorityCoordinate(record.id) ||
    !safeAuthorityCoordinate(record.captureId) ||
    !safeAuthorityCoordinate(record.pendingId) ||
    !Number.isSafeInteger(record.revision) || record.revision! <= 0 ||
    (record.settledBy !== "manual" && record.settledBy !== "automatic") ||
    !Array.isArray(record.artifacts) || record.artifacts.length === 0
  ) return false;
  const seen = new Set<string>();
  let live = 0;
  for (const artifact of record.artifacts) {
    if (
      !artifact ||
      !["action", "thread", "frag", "intention"].includes(artifact.kind) ||
      !safeAuthorityCoordinate(artifact.id)
    ) return false;
    const coordinate = JSON.stringify([artifact.kind, artifact.id]);
    if (seen.has(coordinate)) return false;
    seen.add(coordinate);
    const count = settlementArtifactCount(board, artifact);
    if (count > 1) return false;
    if (count === 1) live += 1;
  }
  return live > 0;
}

const routingSettlementContentKey = (record: RoutingSettlement) => JSON.stringify([
  record.id,
  record.captureId,
  record.pendingId,
  record.revision,
  record.settledBy,
  record.artifacts.map((artifact) => [artifact.kind, artifact.id]),
]);

/** A manual settlement is authoritative for one exact pending row/revision.
 * Two offline devices can both settle that row before either sees the other;
 * once their Boards meet, remove only artifacts declared by the stale
 * automatic settlement in that same slot. Earlier automatic output from a
 * different partial row remains untouched. */
export function reconcileManualSettlementAuthority(board: Board, now = Date.now()): Board {
  const candidates: RoutingSettlement[] = [...(board.routingSettlements ?? [])];
  /* Migration bridge for P5 boards written before durable active-settlement
     metadata. Their still-present ledger rows seed the new boundary once. */
  for (const entry of board.ledger) {
    if (
      entry.undone || !entry.settledBy || !entry.settlementPendingId ||
      entry.settlementRevision === undefined || !entry.settlementArtifacts
    ) continue;
    candidates.push({
      id: entry.id,
      captureId: entry.captureId ?? entry.id,
      pendingId: entry.settlementPendingId,
      revision: entry.settlementRevision,
      settledBy: entry.settledBy,
      artifacts: entry.settlementArtifacts,
    });
  }
  const byContent = new Map<string, RoutingSettlement>();
  for (const record of candidates) byContent.set(routingSettlementContentKey(record), record);
  const idContents = new Map<string, Set<string>>();
  for (const [content, record] of byContent) {
    const existing = idContents.get(record.id) ?? new Set<string>();
    existing.add(content);
    idContents.set(record.id, existing);
  }
  const all = [...byContent.entries()]
    .filter(([, record]) => idContents.get(record.id)?.size === 1)
    .map(([, record]) => record)
    .filter((record) => provenRoutingSettlement(board, record));
  const manualRecords = all.filter((record) => record.settledBy === "manual");
  const retirementMap = new Map(
    mergeRoutingRetirements(board.routingRetirements ?? [], [], now)
      .map((retirement) => [routingSlot(retirement), retirement]),
  );
  for (const record of manualRecords) {
    retirementMap.set(routingSlot(record), {
      captureId: record.captureId,
      pendingId: record.pendingId,
      revision: record.revision,
      retiredAt: now,
    });
  }
  const manualSlots = new Set(retirementMap.keys());
  const losing = all.filter((record) =>
    record.settledBy === "automatic" && manualSlots.has(routingSlot(record))
  );
  for (const record of losing) {
    retirementMap.set(routingSlot(record), {
      captureId: record.captureId,
      pendingId: record.pendingId,
      revision: record.revision,
      retiredAt: now,
    });
  }

  const protectedArtifacts = new Set(all
    .filter((record) => !losing.includes(record))
    .flatMap((record) => record.artifacts)
    .map((artifact) => JSON.stringify([artifact.kind, artifact.id])));
  const retired = new Set(losing
    .flatMap((record) => record.artifacts)
    .filter((artifact) => !protectedArtifacts.has(JSON.stringify([artifact.kind, artifact.id])))
    .map((artifact) => JSON.stringify([artifact.kind, artifact.id])));
  const gone = (kind: "action" | "thread" | "frag" | "intention", id: string) =>
    retired.has(JSON.stringify([kind, id]));
  const actions = board.actions.filter((action) => !gone("action", action.id));
  const referencedThreads = new Set(actions.flatMap((action) =>
    [action.threadId, action.shot?.threadId].filter((id): id is string => !!id)
  ));
  const next = {
    ...board,
    actions,
    // A created Thread is only a container, not ownership of everything later
    // filed there. Legacy manifests without fragment ids must fail safe: keep
    // unknown content rather than infer ownership from the container or time.
    threads: board.threads
      .map((thread) => ({
        ...thread,
        frags: thread.frags.filter((frag) => !gone("frag", frag.id)),
      }))
      .filter((thread) => !gone("thread", thread.id) || thread.frags.length > 0 ||
        referencedThreads.has(thread.id)),
    intentions: board.intentions.filter((intention) => !gone("intention", intention.id)),
    ledger: board.ledger.map((entry) =>
      entry.settledBy === "automatic" && entry.settlementPendingId &&
      entry.settlementRevision !== undefined && manualSlots.has(
        JSON.stringify([
          entry.captureId ?? entry.id,
          entry.settlementPendingId,
          entry.settlementRevision,
        ])
      ) ? {
        ...entry,
        undone: true,
        ...(entry.kind === "pending" ? { imgs: undefined } : {}),
      } : entry
    ),
  };
  return {
    ...next,
    routingSettlements: all.filter((record) =>
      !losing.includes(record) &&
      record.artifacts.some((artifact) => settlementArtifactExists(next, artifact))
    ),
    routingRetirements: [...retirementMap.values()],
  };
}

function collectFragHomes(threads: Thread[]): Map<string, Set<string>> {
  const homes = new Map<string, { timestamp: number; ids: Set<string> }>();
  for (const thread of threads) {
    for (const frag of thread.frags) {
      const timestamp = ts(frag);
      const current = homes.get(frag.id);
      if (!current || timestamp > current.timestamp) {
        homes.set(frag.id, { timestamp, ids: new Set([thread.id]) });
      } else if (timestamp === current.timestamp) {
        current.ids.add(thread.id);
      }
    }
  }
  return new Map([...homes].map(([id, value]) => [id, value.ids]));
}

/** Merge two boards. Pure and deterministic. */
export function mergeBoards(a: Board, b: Board): Board {
  /* History is union-merged, so the only way to start it over is an epoch:
     the side that was started over later wins, and the other side's
     history is dropped rather than merged back in. */
  const ea = a.historyEpoch ?? 0;
  const eb = b.historyEpoch ?? 0;
  const empty = { ledger: [], corrections: [], wraps: [], completions: [] };
  // Pending imports are explicit additions, not evidence of a reset. An
  // accepted receipt wins over stale pending copies, including after a reset.
  const historyImports = { ...a.historyImports, ...b.historyImports };
  for (const [id, status] of Object.entries(a.historyImports ?? {}))
    if (status === "accepted") historyImports[id] = status;
  const pending = (entry: { importBatch?: string }) =>
    !!entry.importBatch && historyImports[entry.importBatch] === "pending";
  const pendingHistory = (board: Board) => ({
    ...empty,
    ledger: (board.ledger ?? []).filter(pending),
    corrections: (board.corrections ?? []).filter(pending),
    wraps: (board.wraps ?? []).filter(pending),
    completions: (board.completions ?? []).filter(pending),
  });
  const ha = ea >= eb ? a : pendingHistory(a);
  const hb = eb >= ea ? b : pendingHistory(b);
  const profile = !a.profile
    ? b.profile
    : !b.profile || ts(a.profile) >= ts(b.profile)
      ? a.profile
      : b.profile;
  return {
    ...a,
    ...b,
    historyEpoch: Math.max(ea, eb),
    ...(Object.keys(historyImports).length ? { historyImports } : {}),
    actions: mergeList(a.actions, b.actions, (x, y) => y.at - x.at),
    threads: mergeThreads(a.threads, b.threads),
    intentions: mergeList(a.intentions, b.intentions, (x, y) => y.at - x.at),
    principles: mergeList(a.principles, b.principles),
    /* Ledger entries never change, so the merge is a plain union. The `??`
       guards boards built before the field existed. */
    ledger: mergeLedgers(ha.ledger ?? [], hb.ledger ?? []),
    /* Same for corrections — append-only records, union by id. */
    corrections: mergeCorrections(ha.corrections ?? [], hb.corrections ?? []),
    routingSettlements: [...new Map([
      ...(a.routingSettlements ?? []),
      ...(b.routingSettlements ?? []),
    ].map((record) => [routingSettlementContentKey(record), record])).values()],
    routingRetirements: mergeRoutingRetirements(
      a.routingRetirements ?? [],
      b.routingRetirements ?? [],
    ),
    /* Wraps are union by day; a dismissal on one device carries. */
    wraps: mergeWraps(ha.wraps ?? [], hb.wraps ?? []),
    /* Ticks are union by action id — recorded once, never changed. */
    completions: mergeCompletions(ha.completions ?? [], hb.completions ?? []),
    profile,
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
  for (const a of board.actions) {
    parts.push(
      `a:${a.id}:${ts(a)}:${a.shot?.threadId ?? ""}:${a.shot?.fragId ?? ""}`
    );
  }
  for (const t of board.threads) {
    parts.push(`t:${t.id}:${t.updatedAt ?? 0}`);
    /* The thread id rides along, so moving a fragment between threads is a
       change even when its own timestamp is untouched. */
    for (const f of t.frags) parts.push(`f:${t.id}:${f.id}:${ts(f)}`);
  }
  for (const i of board.intentions) parts.push(`i:${i.id}:${ts(i)}`);
  for (const p of board.principles) parts.push(`p:${p.id}:${p.updatedAt ?? 0}`);
  if (board.profile)
    parts.push(
      `P:${board.profile.updatedAt ?? 0}:${hashOf(board.profile.name)}:${
        board.profile.imageId ?? ""
      }:${board.profile.showSignature ? 1 : 0}:${board.profile.intentionShowcaseEnabled ? 1 : 0}:${
        hashOf(JSON.stringify(board.profile.pinnedIntentionIds ?? []))
      }:${board.profile.intentionShowcaseCollapsed ? 1 : 0}`
    );
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
  const settlements = board.routingSettlements ?? [];
  parts.push(`S:${settlements.length}:${idsOf(settlements)}`);
  for (const retirement of board.routingRetirements ?? []) {
    parts.push(`R:${routingSlot(retirement)}:${retirement.retiredAt}`);
  }
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
  for (const [id, status] of Object.entries(board.historyImports ?? {}))
    parts.push(`I:${id}:${status}`);

  return parts.sort().join("|");
}

/** The full merge: merge tombstones, remove their claims from both candidate
    topologies, merge the survivors, apply the deletion set once more, and only
    then reconcile denormalized Action-shot homes against that final topology.
    `now` feeds the tombstone horizon and is injectable for tests. */
export function mergeSync(a: SyncState, b: SyncState, now = Date.now()): SyncState {
  const tombstones = mergeTombstones(a.tombstones, b.tombstones, now);
  const liveA = applyTombstones(a.board, tombstones);
  const liveB = applyTombstones(b.board, tombstones);
  const finalBoard = applyTombstones(mergeBoards(liveA, liveB), tombstones);
  const manualAuthority = reconcileManualSettlementAuthority(finalBoard, now);
  const board = reconcileActionShotHomes(manualAuthority);
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

  const profile = !next.profile
    ? undefined
    : !prev.profile
      ? fresh(next.profile)
      : same(prev.profile, next.profile)
        ? next.profile
        : stamp(next.profile);

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
      if (
        prevFragHome.has(f.id) &&
        prevFragHome.get(f.id) !== nextFragHome.get(f.id)
      ) {
        changed = true;
        return stamp(f);
      }
      if (!pf) {
        changed = true;
        return fresh(f);
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
  const routingTopology = { actions, threads, intentions };
  const existingRetirements = mergeRoutingRetirements(
    prev.routingRetirements ?? [],
    next.routingRetirements ?? [],
    now,
  );
  const existingRetirementSlots = new Set(existingRetirements.map(routingSlot));
  const manualRetirements = [
    ...(prev.routingSettlements ?? []),
    ...(next.routingSettlements ?? []),
  ].filter((record) =>
    record.settledBy === "manual" &&
    safeAuthorityCoordinate(record.captureId) &&
    safeAuthorityCoordinate(record.pendingId) &&
    Number.isSafeInteger(record.revision) && record.revision > 0 &&
    (
      !existingRetirementSlots.has(routingSlot(record)) ||
      !record.artifacts.some((artifact) => settlementArtifactExists(routingTopology, artifact))
    )
  ).map((record) => ({
    captureId: record.captureId,
    pendingId: record.pendingId,
    revision: record.revision,
    retiredAt: now,
  }));
  const routingRetirements = mergeRoutingRetirements(
    existingRetirements,
    manualRetirements,
    now,
  );

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
      routingSettlements: (next.routingSettlements ?? []).filter((record) =>
        record.artifacts.some((artifact) => settlementArtifactExists(routingTopology, artifact))
      ),
      routingRetirements,
      profile,
    },
    tombstones,
  };
}
