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
 * Deliberately NOT cached in memory. The old cache was set before the write
 * that was supposed to persist it, which is why a host that could not write
 * a byte still looked like a working hub: the board lived in one instance's
 * memory, and whether a device saw its own push come back was down to which
 * instance answered.
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

/** Read the stored state, hydrating a missing or unparseable document to
    empty, along with the version to quote back on the write. */
async function read(): Promise<{ state: SyncStore; version: string | null }> {
  const stored = await hubStore().read(KEY);
  if (!stored) return { state: empty(), version: null };
  try {
    const parsed = JSON.parse(stored.body) as Partial<SyncStore>;
    return {
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
    return { state: empty(), version: stored.version };
  }
}

/** Serialise every read-modify-write so concurrent pushes can't interleave. */
function locked<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

/** The stored state, for a pull. */
export function getSync(): Promise<SyncStore> {
  return locked(async () => (await read()).state);
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
      if (await hubStore().write(KEY, JSON.stringify(next), { version })) {
        return next;
      }
      /* Someone merged first. Round again, on top of theirs. */
    }
    throw new Error("the hub was being written to too often to settle");
  });
}
