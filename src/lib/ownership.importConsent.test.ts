// @vitest-environment jsdom
import { beforeEach, expect, it } from "vitest";
import { OwnershipLifetime, resumeOfflineIdentity, OfflineTransportError } from "./ownership";
beforeEach(() => localStorage.clear());
const scope = () => new OwnershipLifetime({ owner: "consent", expiresAt: Date.now() + 60000 });
it.each(["assert", "event"])("retires stale import document through %s without removing persistent consent", trigger => {
  const stale = scope(), importing = scope();
  stale.keepOffline(true);
  const stop = stale.watch(async () => ({ owner: "consent", expiresAt: Date.now() + 60000 }));
  importing.beginImport();
  if (trigger === "assert") expect(() => stale.assert()).toThrow();
  else window.dispatchEvent(new StorageEvent("storage", { key: "capture:local-import:consent" }));
  expect(stale.snapshot()).toBe("revoked");
  expect(stale.controller.signal.aborted).toBe(true);
  expect(resumeOfflineIdentity()?.owner).toBe("consent");
  importing.finishImport(); stop();
});
it("does not publish a late import-finished generation after revocation", () => {
  const importing = scope(); importing.beginImport();
  const generation = localStorage.getItem("capture:local-import:consent");
  importing.revoke(); importing.finishImport();
  expect(localStorage.getItem("capture:local-import:consent")).toBe(generation);
});
it("a late server rejection from an import-stale request cannot withdraw device consent", async () => {
  const stale = scope(), importing = scope(); stale.keepOffline(true);
  let finish!: (r: Response) => void;
  const request = stale.request("/api/sync", {}, () => new Promise(resolve => { finish = resolve; }));
  importing.beginImport(); // storage events can be delayed in suspended tabs
  finish(new Response(null, { status: 401 }));
  await expect(request).rejects.toThrow();
  expect(stale.snapshot()).toBe("revoked");
  expect(resumeOfflineIdentity()?.owner).toBe("consent");
  importing.finishImport();
});
it.each(["success", "failure"])("late verification %s checks import generation even without a storage event", async outcome => {
  const stale = scope(), importing = scope(); stale.keepOffline(true);
  let finish!: (identity: { owner: string; expiresAt: number }) => void;
  let fail!: (e: Error) => void;
  const stop = stale.watch(() => new Promise((resolve, reject) => { finish = resolve; fail = reject; }));
  window.dispatchEvent(new Event("focus"));
  importing.beginImport();
  if (outcome === "success") finish({ owner: "consent", expiresAt: Date.now() + 60000 });
  else fail(new Error("rejected"));
  await Promise.resolve(); await Promise.resolve();
  expect(stale.snapshot()).toBe("revoked");
  expect(resumeOfflineIdentity()?.owner).toBe("consent");
  stop(); importing.finishImport();
});
it("late verification failure cannot revoke another document's consent after import retirement", async () => {
  const stale = scope(), importing = scope(); stale.keepOffline(true);
  let reject!: (e: Error) => void;
  const stop = stale.watch(() => new Promise((_, r) => { reject = r; }));
  window.dispatchEvent(new Event("focus"));
  importing.beginImport();
  expect(() => stale.assert()).toThrow();
  reject(new OfflineTransportError());
  await Promise.resolve(); await Promise.resolve();
  expect(stale.snapshot()).toBe("revoked");
  expect(resumeOfflineIdentity()?.owner).toBe("consent");
  stop(); importing.finishImport();
});
