/**
 * The sync hub — where the one merged copy of the board lives.
 *
 * The server is deliberately stateless everywhere else, so this store is the
 * single exception: one document both devices push to and pull from. Every
 * write MERGES the incoming state into what is already stored rather than
 * replacing it, so two devices pushing at once converge instead of
 * clobbering each other.
 *
 * Where the document actually lives is hubStore's problem — a file on the
 * Mac, a private blob on a serverless host. What lives here is the merge and
 * the concurrency around it, at two levels:
 *
 *   - Within one process, `locked` serialises read-modify-write so two
 *     requests cannot interleave.
 *   - Across processes — two serverless instances handling a push each —
 *     the write is conditional on the version that was read. A loser is told
 *     so, re-reads, and merges on top of the winner. Nothing either side
 *     sent is lost, because the merge is a union.
 *
 * Cached in memory — carefully, because the first cache here was a bug. It
 * was set BEFORE the write that was supposed to persist it, so a host that
 * could not write a byte still looked like a working hub: the board lived in
 * one instance's memory, and whether a device saw its own push come back
 * depended on which instance answered.
 *
 * This cache holds only what the store has actually confirmed: the last
 * state READ from it, or the last state it accepted a WRITE of. It is set
 * after the write succeeds, never before, and a failed write clears it.
 *
 * Why cache at all: the blob store got suspended. Each device polled every
 * ten seconds and every poll downloaded the entire document — about 17,000
 * reads and 3 GB a day for two devices that changed nothing — until Vercel
 * switched the store off. A pull is now answered from memory for up to a
 * minute; only a push, which needs the live version for its compare-and-
 * swap, always reads the store. Across two instances that means one may
 * answer "unchanged" up to a minute after the other accepted a write, which
 * is a delay, not a loss: the write itself always went through the store.
 */

import { EMPTY, hydrate } from "./model";
import { hubStore } from "./hubStore";
import { mergeSync, type SyncState } from "./sync";

/** The document's name in whichever store is behind us. */
const KEY = "sync.json";

/** What the hub persists: the merged state plus a monotonic revision. */
export type SyncStore = SyncState & { rev: number };

/** How many times a push re-merges after losing a race before giving up.
    Two devices make a collision rare and a second collision rarer still. */
const PUSH_ATTEMPTS = 4;

let queue: Promise<unknown> = Promise.resolve();

const empty = (): SyncStore => ({ rev: 0, board: EMPTY, tombstones: [] });

/** How long a pull may be answered from memory before the store is asked
    again. Long enough to collapse a device's polls into one real read;
    short enough that a write on another instance shows within a minute. */
export const FRESH_MS = 60_000;

/** What the store last confirmed, and when. `version` is kept only when it
    came from a read — a write does not hand one back, and a push must never
    compare-and-swap against a guess. */
let memory: { state: SyncStore; version: string | null; at: number } | null =
  null;

/** Tests only: forget what the store said. */
export function _forgetHub(): void {
  memory = null;
}

/** Read the stored state FROM THE STORE, hydrating a missing or
    unparseable document to empty, along with the version to quote back on
    the write. Every call here is a real read; remember what came back. */
async function read(
  now = Date.now()
): Promise<{ state: SyncStore; version: string | null }> {
  const stored = await hubStore().read(KEY);
  let out: { state: SyncStore; version: string | null };
  if (!stored) out = { state: empty(), version: null };
  else {
    try {
      const parsed = JSON.parse(stored.body) as Partial<SyncStore>;
      out = {
        state: {
          rev: parsed.rev ?? 0,
          board: hydrate(parsed.board),
          tombstones: Array.isArray(parsed.tombstones) ? parsed.tombstones : [],
        },
        version: stored.version,
      };
    } catch {
      /* Unreadable: treat as empty, but keep the version so the write that
         replaces it is still conditional on what we actually saw. */
      out = { state: empty(), version: stored.version };
    }
  }
  memory = { ...out, at: now };
  return out;
}

/** Serialise every read-modify-write so concurrent pushes can't interleave. */
function locked<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

/** The stored state, for a pull — from memory while it is fresh. */
export function getSync(now = Date.now()): Promise<SyncStore> {
  return locked(async () => {
    if (memory && now - memory.at < FRESH_MS) return memory.state;
    return (await read(now)).state;
  });
}

/** Merge an incoming client state into the hub and persist the result. */
export function pushSync(client: SyncState): Promise<SyncStore> {
  return locked(async () => {
    for (let attempt = 0; attempt < PUSH_ATTEMPTS; attempt++) {
      const { state, version } = await read();
      const merged = mergeSync(
        { board: state.board, tombstones: state.tombstones },
        client
      );
      const next: SyncStore = { ...merged, rev: state.rev + 1 };
      let written = false;
      try {
        written = await hubStore().write(KEY, JSON.stringify(next), { version });
      } catch (error) {
        /* The store refused. Whatever memory held is now suspect — the next
           pull must ask the store, not repeat what it said before. */
        memory = null;
        throw error;
      }
      if (written) {
        /* Confirmed by the store, so it may be served. No version: a write
           does not return one, and a guess must never back a compare-and-
           swap — the next push reads for real. */
        memory = { state: next, version: null, at: Date.now() };
        return next;
      }
      /* Someone merged first. Round again, on top of theirs. */
    }
    memory = null;
    throw new Error("the hub was being written to too often to settle");
  });
}
