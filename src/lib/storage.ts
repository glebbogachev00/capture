/**
 * Local persistence.
 *
 * IndexedDB rather than localStorage: captured photos are held as data URLs,
 * and a handful of them goes straight past localStorage's ~5MB ceiling. The
 * synchronous localStorage API would also jank the UI while writing them.
 *
 * Everything stays on the device. Nothing here is ever sent to the server
 * except the text of a capture, at the moment you ask for it to be sorted.
 */

const DB = "capture";
const STORE = "kv";

let open: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (open) return open;
  open = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return open;
}

function run<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return db().then(
    (conn) =>
      new Promise<T>((resolve, reject) => {
        const tx = conn.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      })
  );
}

export async function get(key: string): Promise<string | null> {
  const value = await run<string | undefined>("readonly", (s) => s.get(key));
  return value ?? null;
}

export async function set(key: string, value: string): Promise<void> {
  await run("readwrite", (s) => s.put(value, key));
}

/** Several writes, one transaction.
 
    Every call to set() opens its own readwrite transaction, and a readwrite
    transaction blocks every read queued behind it on the same store. The
    board commit wrote the board and then the tombstones — two lock windows
    back to back, at exactly the moment cover images are trying to read.
    One transaction halves the blocking for the same bytes, and is also the
    honest unit: a commit's board and tombstones belong together or not at
    all. */
export async function setMany(entries: [string, string][]): Promise<void> {
  const conn = await db();
  await new Promise<void>((resolve, reject) => {
    const tx = conn.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    for (const [key, value] of entries) store.put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function del(key: string): Promise<void> {
  await run("readwrite", (s) => s.delete(key));
}

/** Every key in the store. Used to find the daily snapshots. */
export async function keys(): Promise<string[]> {
  const all = await run<IDBValidKey[]>("readonly", (s) => s.getAllKeys());
  return (all ?? []).map(String);
}
