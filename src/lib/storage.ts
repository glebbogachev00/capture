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

export async function del(key: string): Promise<void> {
  await run("readwrite", (s) => s.delete(key));
}
