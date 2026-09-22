/** @vitest-environment jsdom */
import "fake-indexeddb/auto";
import { afterEach, expect, it, vi } from "vitest";
import { buildBackup } from "./backup";
import {
  createBackupClient,
  repairLegacyBackupImages,
  requestBackupTransfer,
} from "./backupClient";
import { IMG, KEY, EMPTY, type Board } from "./model";
import { OwnershipLifetime } from "./ownership";
import { createStorage } from "./storage";
import { TOMBSTONE_KEY } from "./sync";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=";

afterEach(() => vi.restoreAllMocks());

it("rolls back the entire local v3 restore when an image write fails", async () => {
  localStorage.clear();
  const lifetime = new OwnershipLifetime();
  const store = createStorage(lifetime);
  for (const key of await store.keys()) await store.del(key);
  const prior: Board = {
    ...EMPTY,
    actions: [{ id: "prior", text: "Prior", done: false, at: 1, shelf: "keep", expires: null }],
  };
  await store.setMany([
    [KEY, JSON.stringify(prior)],
    [TOMBSTONE_KEY, JSON.stringify([])],
    [IMG("prior-image"), PNG],
  ]);
  const source: Board = {
    ...EMPTY,
    actions: [{
      id: "restored", text: "Restored", done: false, at: 2, updatedAt: 2,
      shelf: "keep", expires: null, imgs: ["new-image"],
    }],
  };
  const archive = buildBackup(source, { "new-image": PNG });
  const originalPut = IDBObjectStore.prototype.put;
  vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function(
    this: IDBObjectStore, value, key,
  ) {
    if (key === IMG("new-image")) throw new DOMException("Disk full", "QuotaExceededError");
    return originalPut.call(this, value, key);
  });

  await expect(createBackupClient(lifetime).restoreV3(
    archive, { board: prior, tombstones: [] },
  )).rejects.toThrow("Disk full");

  expect(await store.get(KEY)).toBe(JSON.stringify(prior));
  expect(await store.get(TOMBSTONE_KEY)).toBe("[]");
  expect(await store.get(IMG("prior-image"))).toBe(PNG);
  expect(await store.get(IMG("new-image"))).toBeNull();
});

it("repairs missing or corrupt v2 bytes even when the board already references the image id", async () => {
  const writes: [string, string][] = [];
  const board = {
    ...EMPTY,
    actions: [{ id: "existing", text: "Existing", done: false, at: 1, shelf: "keep" as const,
      expires: null, imgs: ["missing", "corrupt", "healthy"] }],
  };
  const stored = new Map<string, string | null>([
    ["missing", null],
    ["corrupt", "data:image/png;base64,broken"],
    ["healthy", PNG],
  ]);
  await repairLegacyBackupImages(
    board,
    { missing: PNG, corrupt: PNG, healthy: PNG },
    async (id) => stored.get(id) ?? null,
    async (id, src) => { writes.push([id, src]); },
  );
  expect(writes).toEqual([["missing", PNG], ["corrupt", PNG]]);
});

it("paces a quota denial and resumes the same transfer instead of restarting", async () => {
  let calls = 0;
  const waits: number[] = [];
  const response = await requestBackupTransfer(
    async () => ++calls === 1
      ? new Response(null, { status: 429, headers: { "Retry-After": "2" } })
      : Response.json({ ok: true }),
    async (milliseconds) => { waits.push(milliseconds); },
  );
  expect(response.ok).toBe(true);
  expect(calls).toBe(2);
  expect(waits).toEqual([2_000]);
});

it("rejects a mismatched image acknowledgement before the Cloud board PUT", async () => {
  localStorage.clear();
  const lifetime = new OwnershipLifetime({ owner: "alice", expiresAt: Date.now() + 60_000 });
  const source: Board = {
    ...EMPTY,
    actions: [{ id: "restored", text: "Restored", done: false, at: 2,
      shelf: "keep", expires: null, imgs: ["image"] }],
  };
  const archive = buildBackup(source, { image: PNG }, [], { kind: "cloud", ownerId: "alice" });
  const requests: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requests.push(`${init?.method ?? "GET"} ${url}`);
    if (url === "/api/cloud/identity") {
      return Response.json({ owner: "alice", expiresAt: Date.now() + 60_000 });
    }
    if (url === "/api/cloud/board?backup=1") {
      return Response.json({ board: EMPTY, tombstones: [], rev: 1 });
    }
    if (url === "/api/img/image?backup=1" && init?.method === "PUT") {
      return Response.json({ digest: "0".repeat(64), mime: "image/png", length: 1 });
    }
    return new Response(null, { status: 500 });
  }));

  await expect(createBackupClient(lifetime).restoreV3(
    archive,
    { board: EMPTY, tombstones: [] },
  )).rejects.toThrow(/could not be verified/i);
  expect(requests.some((entry) => entry === "PUT /api/cloud/board")).toBe(false);
});
