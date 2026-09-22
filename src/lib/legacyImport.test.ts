// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { beforeEach, expect, it, vi } from "vitest";
import { OwnershipLifetime } from "./ownership";
import { createStorage } from "./storage";
import { EMPTY, KEY, IMG } from "./model";
import { hasLegacyDatabase, importLegacyBoard, LEGACY_SNAPSHOT, LEGACY_RECEIPT } from "./legacyImport";
import { hydrate } from "./model";
import { mergeBoards } from "./sync";
import { referencedImageIds } from "./imgSync";
import { appendLedger } from "./ledger";
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=";
const scope = () => new OwnershipLifetime({ owner: "import-test", expiresAt: Date.now() + 60000 });
const legacy = createStorage(new OwnershipLifetime());
it("preserves colliding entries, references and different photo bytes without replacing the destination", async () => {
  const current = { ...EMPTY, profile: { name: "Account", imageId: "photo" }, threads: [{ id: "same", name: "account", summary: "", frags: [{ id: "frag", at: 1, text: "account", imgs: ["photo"] }] }] };
  const incoming = { ...current, profile: { name: "Earlier", imageId: "photo" }, threads: [{ ...current.threads[0], name: "earlier", cover: "img:photo", frags: [{ id: "frag", at: 7, text: "earlier", imgs: ["photo", "missing"] }] }], ledger: [{ id: "record", targetId: "same", targetFragId: "frag", raw: "earlier", clean: "earlier", at: 7, kind: "thread", source: "typed", imgs: ["historical"] }], extraField: { untouched: true } };
  await legacy.setMany([[KEY, JSON.stringify(incoming)], [IMG("photo"), "earlier bytes"], [IMG("historical"), "record photo"]]);
  const life = scope(), target = createStorage(life);
  await target.setMany([[KEY, JSON.stringify(current)], [IMG("photo"), "account bytes"]]);
  const receipt = await importLegacyBoard(life, true);
  const imported = JSON.parse((await target.get(KEY))!);
  expect(imported.threads).toHaveLength(2);
  expect(imported.threads[0]).toEqual(current.threads[0]);
  expect(imported.profile).toEqual(current.profile);
  const added = imported.threads[1];
  expect(added.id).not.toBe("same");
  expect(added.frags[0].id).not.toBe("frag");
  expect(imported.ledger[0].targetId).toBe(added.id);
  expect(imported.ledger[0].targetFragId).toBe(added.frags[0].id);
  expect(added.frags[0].at).toBe(7);
  expect(added.cover).toBe(`img:${added.frags[0].imgs[0]}`);
  expect(await target.get(IMG(added.frags[0].imgs[0]))).toBe("earlier bytes");
  expect(await target.get(IMG(imported.ledger[0].imgs[0]))).toBe("record photo");
  expect(referencedImageIds(imported)).toContain(imported.ledger[0].imgs[0]);
  expect(await target.get(IMG("photo"))).toBe("account bytes");
  expect(receipt.missingPhotos).toEqual(["missing"]);
  expect(imported.extraField).toEqual({ untouched: true });
});
it("rolls back a failed copy, retains the committed snapshot and resumes it without rereading changed originals", async () => {
  await legacy.setMany([[KEY, JSON.stringify({ ...EMPTY, profile: { name: "Original", imageId: "pic" } })], [IMG("pic"), "bytes"]]);
  const life = scope(), target = createStorage(life);
  const put = IDBObjectStore.prototype.put;
  const fault = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function(this: IDBObjectStore, value, key) {
    if (String(key).startsWith("capture:img:legacy-")) throw new DOMException("Disk full", "QuotaExceededError");
    return put.call(this, value, key);
  });
  await expect(importLegacyBoard(life, true)).rejects.toThrow("Disk full");
  fault.mockRestore();
  expect(await target.get(LEGACY_SNAPSHOT)).not.toBeNull();
  expect(await target.get(KEY)).toBeNull();
  expect(await target.get(LEGACY_RECEIPT)).toBeNull();
  await legacy.set(KEY, JSON.stringify({ ...EMPTY, profile: { name: "Later" } }));
  await Promise.all([importLegacyBoard(life, true), importLegacyBoard(life, true)]);
  expect(JSON.parse((await target.get(KEY))!).profile.name).toBe("Original");
});
it.each(["snapshot", "copy"])("revocation during %s cannot apply a partial import", async (step) => {
  await legacy.set(KEY, JSON.stringify(EMPTY));
  const life = scope();
  const put = IDBObjectStore.prototype.put;
  const fault = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function(this: IDBObjectStore, value, key) {
    if (key === (step === "snapshot" ? LEGACY_SNAPSHOT : KEY)) life.revoke();
    return put.call(this, value, key);
  });
  await expect(importLegacyBoard(life, true)).rejects.toThrow();
  fault.mockRestore();
  const target = createStorage(scope());
  expect(await target.get(KEY)).toBeNull();
  expect(await target.get(LEGACY_RECEIPT)).toBeNull();
  expect(await legacy.get(KEY)).toBe(JSON.stringify(EMPTY));
});
it("refuses offline, anonymous and malformed sources before any destination board copy", async () => {
  for (const identity of [{ owner: null, expiresAt: Date.now() + 60000 }, { owner: "A", expiresAt: Date.now() + 60000, offline: true }]) {
    await expect(importLegacyBoard(new OwnershipLifetime(identity), true)).rejects.toThrow();
  }
  await legacy.set(KEY, "null");
  await expect(importLegacyBoard(scope(), true)).rejects.toThrow(/board/i);
  expect(await createStorage(scope()).get(KEY)).toBeNull();
});
it.each([[100, 0, false], [0, 100, false], [100, 0, true], [0, 100, true]] as const)("keeps source epoch %s and destination epoch %s history (downloaded=%s) through first reconciliation", async (sourceEpoch, destinationEpoch, downloaded) => {
  const entry = (id: string) => ({ id, at: 1, raw: id, clean: id, kind: "action" as const, source: "typed" as const, targetId: id });
  const histories = (id: string) => ({ ledger: [entry(id)], corrections: [{ id, at: 1, proposalKind: "rename_thread" as const, accepted: true, context: id }], completions: [{ id, at: 1, text: id }], wraps: [{ day: "2026-09-01", at: 1, line: id, stats: { day: "2026-09-01", said: 1, threadsMoved: 0, actionsMade: 1, intentions: 0, threads: [], firstAt: 1, lastAt: 1, finished: [], returns: [] }, insights: [], tomorrow: "" }] });
  await legacy.set(KEY, JSON.stringify({ ...EMPTY, historyEpoch: sourceEpoch, ...histories("source") }));
  const life = scope(), target = createStorage(life);
  const remote = { ...EMPTY, historyEpoch: destinationEpoch, ...histories("destination") };
  if (downloaded) await target.set(KEY, JSON.stringify(remote));
  await importLegacyBoard(life, true);
  const local = hydrate(JSON.parse((await target.get(KEY))!));
  for (const merged of [mergeBoards(local, remote), mergeBoards(remote, local)]) {
    expect(merged.ledger.map(e => e.raw).sort()).toEqual(["destination", "source"]);
    expect(merged.corrections.map(e => e.context).sort()).toEqual(["destination", "source"]);
    expect(merged.completions?.map(e => e.text).sort()).toEqual(["destination", "source"]);
    expect(merged.wraps?.map(e => e.line).sort()).toEqual(["destination", "source"]);
    expect(merged.historyEpoch).toBe(destinationEpoch);
  }
});
it("retains an unpaid local import across offline reopen and reconciles after entitlement with a concurrent destination update", async () => {
  const { handleCloudBoardPut } = await import("./cloudBoard");
  const entry = (id: string) => ({ id, at: 1, raw: id, clean: id, kind: "action" as const, source: "typed" as const, targetId: id });
  await legacy.set(KEY, JSON.stringify({ ...EMPTY, historyEpoch: 9, ledger: [entry("source")] }));
  const life = scope(); life.keepOffline(true);
  await importLegacyBoard(life, true);
  const offline = new OwnershipLifetime({ owner: life.owner, expiresAt: 0, offline: true });
  const raw = await createStorage(offline).get(KEY);
  const local = hydrate(JSON.parse(raw!));
  await expect(offline.request("/api/sync")).rejects.toThrow();
  let current = { state: { board: { ...EMPTY, historyEpoch: 100, ledger: [entry("destination")] }, tombstones: [] }, rev: 1 } as import("./cloudBoard").CloudBoardDocument;
  let paid = false, conflict = true;
  const repository = {
    get: vi.fn(async () => current),
    create: vi.fn(async () => null),
    update: vi.fn(async (_owner: string, revision: number, state: import("./sync").SyncState) => {
      if (conflict) {
        conflict = false;
        current = { rev: 2, state: { ...current.state, board: { ...current.state.board, ledger: [...current.state.board.ledger, entry("concurrent")] } } };
        return null;
      }
      expect(revision).toBe(current.rev);
      current = { rev: current.rev + 1, state }; return current;
    }),
  };
  const request = () => new Request("https://capture.test/api/cloud/board", { method: "PUT", headers: { "X-Capture-Owner": life.owner! }, body: JSON.stringify({ board: local, tombstones: [] }) });
  const deps = {
    isEnabled: () => true,
    verifyIdentity: async () => ({ userId: life.owner! }),
    requiresEntitlement: () => true,
    hasEntitlement: async () => paid,
    isAccountErasing: async () => false,
    consumeQuota: async () => ({ allowed: true, retryAfterSec: 0 }),
    repository,
  };
  expect((await handleCloudBoardPut(request(), deps)).status).toBe(402);
  expect(repository.get).not.toHaveBeenCalled();
  expect(await createStorage(offline).get(KEY)).toBe(raw);
  paid = true;
  const response = await handleCloudBoardPut(request(), deps);
  expect(response.status).toBe(200);
  const accepted = await response.json();
  expect(accepted.board.ledger.map((e: { raw: string }) => e.raw).sort()).toEqual(["concurrent", "destination", "source"]);
  expect(current.state.board).toEqual(accepted.board);
  expect(Object.values(accepted.board.historyImports)).toEqual(["accepted"]);
  expect(repository.update).toHaveBeenCalledTimes(2);
});
it("keeps full imported Records and same-day wraps through hydration, a new capture, and a sync echo", async () => {
  const wrap = { day: "2026-09-01", at: 10, line: "Earlier", stats: {}, insights: [], tomorrow: "" };
  const ledger = Array.from({ length: 501 }, (_, i) => ({ id: `record-${i}`, at: i, raw: "earlier", clean: "earlier", kind: "action" as const, source: "typed" as const, targetId: "action" }));
  await legacy.set(KEY, JSON.stringify({ ...EMPTY, ledger, wraps: [wrap], extraField: "retain" }));
  const life = scope(), target = createStorage(life);
  await target.set(KEY, JSON.stringify({ ...EMPTY, wraps: [{ ...wrap, line: "Account" }] }));
  await importLegacyBoard(life, true);
  const board = hydrate(JSON.parse((await target.get(KEY))!));
  expect((board as unknown as {extraField: string}).extraField).toBe("retain");
  expect(appendLedger(board.ledger, { ...ledger[0], id: "new" })).toHaveLength(502);
  const echoed = mergeBoards(board, board);
  expect(echoed.ledger).toHaveLength(501);
  expect(echoed.wraps).toHaveLength(2);
  expect((echoed as unknown as { extraField: string }).extraField).toBe("retain");
});
it("invalidates another mounted same-account document before importing, so stale hooks cannot overwrite the receipt's board", async () => {
  await legacy.set(KEY, JSON.stringify(EMPTY));
  const importing = scope(), stale = scope();
  const staleStore = createStorage(stale);
  const otherAccount = new OwnershipLifetime({ owner: "unrelated", expiresAt: Date.now() + 60000 });
  const put = IDBObjectStore.prototype.put;
  let midImport: OwnershipLifetime | undefined;
  const spy = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function(this: IDBObjectStore, value, key) {
    if (key === LEGACY_SNAPSHOT) midImport = scope();
    return put.call(this, value, key);
  });
  await importLegacyBoard(importing, true);
  spy.mockRestore();
  expect(() => midImport!.assert()).toThrow();
  expect(scope().active).toBe(true);
  await expect(staleStore.set(KEY, JSON.stringify({ ...EMPTY, profile: { name: "stale" } }))).rejects.toThrow();
  expect(otherAccount.active).toBe(true);
  expect(await createStorage(importing).get(LEGACY_RECEIPT)).not.toBeNull();
});
beforeEach(async () => {
  localStorage.clear();
  for (const store of [legacy, createStorage(scope())]) for (const k of await store.keys()) await store.del(k);
});
it("detects without reading contents; consent imports to the verified unpaid account with recoverable snapshot and untouched originals", async () => {
  const source = { ...EMPTY, futureField: { original: true }, profile: { name: "Earlier", imageId: "photo", futureProfile: "preserve" }, threads: [{ id: "thread", name: "PRIVATE", summary: "", at: 10, frags: [{ id: "frag", at: 11, text: "original", imgs: ["photo"] }], cover: "img:photo" }], historyEpoch: 123 };
  const raw = JSON.stringify(source);
  await legacy.setMany([[KEY, raw], [IMG("photo"), PNG], ["future-device-setting", "opaque original"]]);
  const opened = vi.spyOn(indexedDB, "open");
  expect(await hasLegacyDatabase()).toBe(true);
  expect(opened).not.toHaveBeenCalled();
  opened.mockRestore();
  const life = scope();
  await expect(importLegacyBoard(life, false)).rejects.toThrow(/confirm/i);
  const target = createStorage(life);
  expect(await target.get(KEY)).toBeNull();
  const result = await importLegacyBoard(life, true);
  const imported = JSON.parse((await target.get(KEY))!);
  expect(imported.threads[0].name).toBe("PRIVATE");
  expect(imported.threads[0].frags[0].at).toBe(11);
  expect(imported.historyEpoch).toBe(0); // Source epoch remains only in the archive.
  expect(await target.get(IMG(imported.profile.imageId))).toBe(PNG);
  expect(JSON.parse((await target.get(LEGACY_SNAPSHOT))!).entries).toContainEqual([KEY, raw]);
  expect(result.missingPhotos).toEqual([]);
  expect(await target.get(LEGACY_RECEIPT)).not.toBeNull();
  expect(await legacy.get(KEY)).toBe(raw);
  expect(await legacy.get(IMG("photo"))).toBe(PNG);
  const { readLegacyBackup } = await import("./legacyImport");
  const backup = await readLegacyBackup(life);
  expect(backup.board).toEqual(source);
  expect(backup.deviceSnapshot.entries).toContainEqual(["future-device-setting", "opaque original"]);
  const { restoreBackup } = await import("./backup");
  const recovered = hydrate(restoreBackup(backup, EMPTY).board);
  expect(recovered).toMatchObject({ futureField: source.futureField, profile: source.profile });
  expect(backup.images?.photo).toBe(PNG);
  const again = await importLegacyBoard(life, true);
  expect(again).toEqual(result);
  expect(await target.get(KEY)).toBe(JSON.stringify(imported));
});
