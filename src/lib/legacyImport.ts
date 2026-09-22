import { markHistoryImport } from "./historyImport";
import { buildBackup } from "./backup";
import { type OwnershipLifetime } from "./ownership";
import { createStorage } from "./storage";
import { KEY, IMG, type Board } from "./model";
import { TOMBSTONE_KEY, type Tombstone } from "./sync";


export const LEGACY_SNAPSHOT = "capture:legacy-import:snapshot:v1";
export const LEGACY_RECEIPT = "capture:legacy-import:receipt:v1";
export const LEGACY_DEFERRED = "capture:legacy-import:deferred:v1";
type Snapshot = { version: 1; id: string; entries: [string, string][] };
export type ImportReceipt = { status: "Imported on this device"; missingPhotos: string[] };

/** Database names only. Never open the legacy store to show an invitation. */
export async function hasLegacyDatabase(): Promise<boolean> {
  if (typeof indexedDB.databases !== "function") return false;
  return (await indexedDB.databases()).some(db => db.name === "capture");
}
function assertDestination(lifetime: OwnershipLifetime) {
  lifetime.assertOnline();
  if (!lifetime.cloud || !lifetime.owner) throw new Error("Sign in online to choose an import destination");
}
/** Explicit consent is required before this first private read. Always readonly. */
async function readLegacy(lifetime: OwnershipLifetime): Promise<Snapshot> {
  if (!await hasLegacyDatabase()) throw new Error("The earlier database is not available");
  assertDestination(lifetime);
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("capture");
    open.onupgradeneeded = () => { open.transaction?.abort(); };
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      try {
        assertDestination(lifetime);
        const tx = db.transaction("kv", "readonly");
        const store = tx.objectStore("kv");
        const keys = store.getAllKeys();
        const values = store.getAll();
        const stop = lifetime.subscribe(() => {
          if (lifetime.snapshot() !== "active") { try { tx.abort(); } catch { /* complete */ } }
        });
        tx.oncomplete = () => {
          stop(); db.close();
          try {
            assertDestination(lifetime);
            resolve({ version: 1, id: crypto.randomUUID().replaceAll("-", ""), entries: keys.result.map((key, i) => [String(key), values.result[i]]) });
          } catch (error) { reject(error); }
        };
        tx.onerror = tx.onabort = () => { stop(); db.close(); reject(tx.error ?? new Error("Import interrupted")); };
      } catch (error) { db.close(); reject(error); }
    };
  });
}

/** Walk structure, not prose: never rewrite a user's text that happens to match an id. */
function walk(value: unknown, map: (key: string, value: string) => string, key = ""): unknown {
  if (typeof value === "string") return map(key, value);
  if (Array.isArray(value)) return value.map(item => walk(item, map, key));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v, map, k)]));
  return value;
}
const entityKey = (key: string) => key === "id" || (key.endsWith("Id") && key !== "imageId") || key.endsWith("Ids");
function copyBoard(board: Board, source: Map<string, string>, entries: Map<string, string>, batch: string) {
  const current = entries.has(KEY) ? JSON.parse(entries.get(KEY)!) as Board : null;
  const occupied = new Set<string>(entries.keys());
  walk(current, (key, value) => { if (entityKey(key)) occupied.add(value); return value; });
  // Tombstones and historical references also reserve identifiers.
  for (const [key, value] of entries) if (key.includes("tombstone")) {
    walk(JSON.parse(value), (k, v) => { if (entityKey(k)) occupied.add(v); return v; });
  }
  const ids = new Map<string, string>(), photos = new Map<string, string>();
  let n = 0;
  const allocate = () => {
    let id: string;
    do { id = `legacy-${batch}-${++n}`; } while (occupied.has(id) || occupied.has(IMG(id)));
    occupied.add(id); return id;
  };
  const missingPhotos: string[] = [];
  const photo = (id: string) => {
    if (!photos.has(id)) {
      const next = allocate();
      photos.set(id, next);
      const bytes = source.get(IMG(id));
      if (bytes) entries.set(IMG(next), bytes);
      else missingPhotos.push(id);
    }
    return photos.get(id)!;
  };
  const remapped = walk(board, (key, value) => {
    if (key === "imgs" || key === "imageId") return photo(value);
    if (key === "cover" && value.startsWith("img:")) return `img:${photo(value.slice(4))}`;
    if (entityKey(key)) {
      if (!ids.has(value)) ids.set(value, allocate());
      return ids.get(value)!;
    }
    return value;
  }) as Board;
  const imported = markHistoryImport(remapped, current, batch);
  if (!current) return { merged: imported, missingPhotos };
  // Preserve every field. Lists append without LWW, date rewriting or history caps.
  // A singleton conflict (profile, for example) keeps the account's selection.
  // The complete earlier value remains in the recoverable snapshot.
  const merged = { ...imported, ...current, historyImports: imported.historyImports } as Board & Record<string, unknown>;
  for (const [key, value] of Object.entries(imported)) {
    if (Array.isArray(value)) {
      const before = (current as Board & Record<string, unknown>)[key];
      const additions = key === "principles" ? value.filter((_, i) => !current.principles.some(p => JSON.stringify(p) === JSON.stringify(board.principles[i]))) : value;
      merged[key] = [...(Array.isArray(before) ? before : []), ...additions];
    }
  }
  return { merged, missingPhotos };
}

export async function readLegacyBackup(lifetime: OwnershipLifetime) {
  lifetime.assertDisclosure();
  const raw = await createStorage(lifetime).get(LEGACY_SNAPSHOT);
  lifetime.assertDisclosure();
  if (!raw) throw new Error("No earlier-board snapshot is saved in this account");
  const snapshot = JSON.parse(raw) as Snapshot;
  const entries = new Map(snapshot.entries);
  const board = JSON.parse(entries.get(KEY)!) as Board;
  const images = Object.fromEntries(snapshot.entries.filter(([key]) => key.startsWith(IMG(""))).map(([key, value]) => [key.slice(IMG("").length), value]));
  let tombstones: Tombstone[] = [];
  try {
    const value = JSON.parse(entries.get(TOMBSTONE_KEY) ?? "[]");
    if (Array.isArray(value)) tombstones = value;
  } catch { /* the device snapshot still preserves an unreadable entry */ }
  const scope = lifetime.cloud && lifetime.owner
    ? { kind: "cloud" as const, ownerId: lifetime.owner }
    : { kind: "local" as const };
  return { ...buildBackup(board, images, tombstones, scope), deviceSnapshot: snapshot };
}

export async function importLegacyBoard(lifetime: OwnershipLifetime, accessConfirmed: boolean): Promise<ImportReceipt> {
  if (!accessConfirmed) throw new Error("Confirm that you have permission to access the earlier board");
  assertDestination(lifetime);
  const store = createStorage(lifetime);
  const completed = await store.get(LEGACY_RECEIPT);
  assertDestination(lifetime);
  if (completed) return JSON.parse(completed);
  lifetime.beginImport();
  try {
  let saved = await store.get(LEGACY_SNAPSHOT);
  assertDestination(lifetime);
  if (!saved) {
    const snapshot = await readLegacy(lifetime);
    assertDestination(lifetime);
    saved = await store.atomic(entries => {
      if (!entries.has(LEGACY_SNAPSHOT)) entries.set(LEGACY_SNAPSHOT, JSON.stringify(snapshot));
      return entries.get(LEGACY_SNAPSHOT)!;
    });
  }
  // Snapshot must commit before any board/photo copy. Retry uses that same source.
  assertDestination(lifetime);
  const snapshot = JSON.parse(saved) as Snapshot;
  const source = new Map(snapshot.entries);
  const raw = source.get(KEY);
  if (!raw) throw new Error("The earlier database has no saved board. Originals are unchanged.");
  const board = JSON.parse(raw) as Board;
  if (!board || typeof board !== "object" || !Array.isArray(board.actions) || !Array.isArray(board.threads) ||
      ["intentions", "principles", "ledger", "corrections", "wraps", "completions"].some(key => {
        const value = (board as Board & Record<string, unknown>)[key];
        return value !== undefined && !Array.isArray(value);
      })) throw new Error("The earlier board is not readable. Its snapshot and originals are unchanged.");
  return await store.atomic(entries => {
    assertDestination(lifetime);
    const receipt = entries.get(LEGACY_RECEIPT);
    if (receipt) return JSON.parse(receipt) as ImportReceipt;
    const { merged, missingPhotos } = copyBoard(board, source, entries, snapshot.id);
    entries.set(KEY, JSON.stringify(merged));
    const result: ImportReceipt = { status: "Imported on this device", missingPhotos };
    entries.set(LEGACY_RECEIPT, JSON.stringify(result));
    return result;
  });
  } finally { lifetime.finishImport(); }
}
