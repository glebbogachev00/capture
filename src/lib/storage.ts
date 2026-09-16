import { getDocumentLifetime, type OwnershipLifetime } from "./ownership";

/** All keys (board, drafts, images, snapshots, tombstones) share the SAME
 * immutable ownership namespace. Cloud never opens or migrates legacy capture.
 * Transactions queued before revocation are aborted; stale reads cannot escape.
 */
export function createStorage(lifetime: OwnershipLifetime) {
  const STORE = "kv";
  let open: Promise<IDBDatabase> | null = null;
  function db() {
    lifetime.assert();
    if (!open) open = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(lifetime.database, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return open;
  }
  async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
    const conn = await db();
    lifetime.assert();
    return new Promise<T>((resolve, reject) => {
      const tx = conn.transaction(STORE, mode);
      const abort = () => { try { tx.abort(); } catch { /* already complete */ } };
      lifetime.controller.signal.addEventListener("abort", abort, { once: true });
      const finish = () => lifetime.controller.signal.removeEventListener("abort", abort);
      let req: IDBRequest<T> | void;
      const store = tx.objectStore(STORE);
      if (lifetime.cloud) {
        // IDB transactions can wait behind an import. Recheck at execution,
        // not only when queued, before a stale full-board write can land.
        store.count("capture:ownership-guard").onsuccess = () => {
          try { lifetime.assert(); req = fn(store); } catch { abort(); }
        };
      } else req = fn(store);
      tx.oncomplete = () => {
        finish();
        try { lifetime.assert(); resolve(req?.result as T); } catch (e) { reject(e); }
      };
      tx.onerror = tx.onabort = () => { finish(); reject(tx.error ?? new DOMException("Ownership revoked", "AbortError")); };
    });
  }
  return {
    /** A synchronous read/modify/write transaction for consented local import.
     * No await in update. Other tabs cannot interleave writes with this copy. */
    async atomic<T>(update: (entries: Map<string, string>) => T): Promise<T> {
      lifetime.assertOnline();
      const conn = await db();
      lifetime.assertOnline();
      return new Promise<T>((resolve, reject) => {
        const tx = conn.transaction(STORE, "readwrite");
        const store = tx.objectStore(STORE);
        let result: T;
        let failure: unknown;
        const stop = lifetime.subscribe(() => {
          if (lifetime.snapshot() !== "active") { try { tx.abort(); } catch { /* complete */ } }
        });
        const keys = store.getAllKeys();
        const values = store.getAll();
        values.onsuccess = () => {
          try {
            lifetime.assertOnline();
            const original = new Map(keys.result.map((key, i) => [String(key), values.result[i] as string]));
            const entries = new Map(original);
            result = update(entries);
            for (const [key, value] of entries) if (original.get(key) !== value) store.put(value, key);
            for (const key of original.keys()) if (!entries.has(key)) store.delete(key);
          } catch (error) { failure = error; tx.abort(); }
        };
        tx.oncomplete = () => { stop(); try { lifetime.assertOnline(); resolve(result); } catch (error) { reject(error); } };
        tx.onabort = tx.onerror = () => { stop(); reject(failure ?? tx.error ?? new DOMException("Import interrupted", "AbortError")); };
      });
    },
    async get(key: string): Promise<string | null> { return await run<string | undefined>("readonly", s => s.get(key)) ?? null; },
    async set(key: string, value: string): Promise<void> { await run("readwrite", s => s.put(value, key)); },
    async setMany(entries: [string, string][]): Promise<void> {
      await run("readwrite", s => { for (const [key, value] of entries) s.put(value, key); });
    },
    async del(key: string): Promise<void> { await run("readwrite", s => s.delete(key)); },
    async keys(): Promise<string[]> { return (await run<IDBValidKey[]>("readonly", s => s.getAllKeys())).map(String); },
  };
}
const stores = new WeakMap<OwnershipLifetime, ReturnType<typeof createStorage>>();
function storage() {
  const lifetime = getDocumentLifetime();
  let store = stores.get(lifetime);
  if (!store) { store = createStorage(lifetime); stores.set(lifetime, store); }
  return store;
}
export const get = (key: string) => storage().get(key);
export const set = (key: string, value: string) => storage().set(key, value);
export const setMany = (entries: [string, string][]) => storage().setMany(entries);
export const del = (key: string) => storage().del(key);
export const keys = () => storage().keys();
