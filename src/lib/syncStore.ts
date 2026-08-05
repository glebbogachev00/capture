/**
 * The sync hub — where the one merged copy of the board lives.
 *
 * The server is deliberately stateless everywhere else, so this store is the
 * single exception: a JSON file the Mac keeps, which both devices push to and
 * pull from. Every write MERGES the incoming state into what is already
 * stored rather than replacing it, so two devices pushing at once converge
 * instead of clobbering each other.
 *
 * Atomicity: writes go to a temp file then rename over the live one, so a
 * crash mid-write can never leave a half-written board. Reads and writes are
 * serialised through a promise chain so two concurrent pushes can't interleave
 * a read-modify-write.
 *
 * Storage location: $SYNC_DATA_DIR if set, else `.data/` under the project
 * root. Self-hosted on the Mac this is a real disk, which is exactly what a
 * hub needs. (A serverless host like Vercel would need a managed database —
 * see the design notes.)
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { EMPTY, hydrate } from "./model";
import { mergeSync, type SyncState } from "./sync";

const DIR = process.env.SYNC_DATA_DIR || path.join(process.cwd(), ".data");
const FILE = path.join(DIR, "sync.json");
const TMP = FILE + ".tmp";

/** What the hub persists: the merged state plus a monotonic revision. */
export type SyncStore = SyncState & { rev: number };

let cache: SyncStore | null = null;
let queue: Promise<unknown> = Promise.resolve();

/** Read the stored state, hydrating a missing or unparseable file to empty. */
async function read(): Promise<SyncStore> {
  if (cache) return cache;
  try {
    const raw = await fs.readFile(FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<SyncStore>;
    cache = {
      rev: parsed.rev ?? 0,
      board: hydrate(parsed.board),
      tombstones: Array.isArray(parsed.tombstones) ? parsed.tombstones : [],
    };
  } catch {
    cache = { rev: 0, board: EMPTY, tombstones: [] };
  }
  return cache;
}

/** Persist atomically and update the in-memory cache. */
async function write(next: SyncStore): Promise<void> {
  cache = next;
  await fs.mkdir(DIR, { recursive: true });
  await fs.writeFile(TMP, JSON.stringify(next), "utf8");
  await fs.rename(TMP, FILE);
}

/** Serialise every read-modify-write so concurrent pushes can't interleave. */
function locked<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

/** The stored state, for a pull. */
export function getSync(): Promise<SyncStore> {
  return locked(read);
}

/** Merge an incoming client state into the hub and persist the result. */
export function pushSync(client: SyncState): Promise<SyncStore> {
  return locked(async () => {
    const cur = await read();
    const merged = mergeSync(
      { board: cur.board, tombstones: cur.tombstones },
      client
    );
    const next: SyncStore = { ...merged, rev: cur.rev + 1 };
    await write(next);
    return next;
  });
}
