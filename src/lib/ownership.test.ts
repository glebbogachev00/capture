// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { expect, it, vi } from "vitest";
import { OwnershipLifetime } from "./ownership";
import { createStorage } from "./storage";
import { ensureHubImage } from "./imgSync";

it("keeps A -> B -> A, anonymous and legacy storage independent without migration", async () => {
  const scope = (owner: string | null) => new OwnershipLifetime({ owner, expiresAt: Date.now() + 60000 });
  const legacy = createStorage(new OwnershipLifetime());
  await legacy.set("secret", "unknown legacy");
  const a = createStorage(scope("A"));
  await a.set("secret", "A private");
  const anon = createStorage(scope(null));
  await anon.set("secret", "anonymous private");
  expect(await createStorage(scope("B")).get("secret")).toBeNull();
  expect(await createStorage(scope("A")).get("secret")).toBe("A private");
  expect(await createStorage(scope(null)).get("secret")).toBe("anonymous private");
  expect(await legacy.get("secret")).toBe("unknown legacy");
});

it("refuses queued storage writes and reads after revocation", async () => {
  const lease = new OwnershipLifetime({ owner: "queued", expiresAt: Date.now() + 60000 });
  const store = createStorage(lease);
  const write = store.set("secret", "late");
  lease.revoke();
  await expect(write).rejects.toThrow();
  await expect(store.get("secret")).rejects.toThrow();
  const reopened = createStorage(new OwnershipLifetime({ owner: "queued", expiresAt: Date.now() + 60000 }));
  expect(await reopened.get("secret")).toBeNull();
});

it("rejects a held response and HEAD -> PUT continuation after revocation", async () => {
  const lease = new OwnershipLifetime({ owner: "A", expiresAt: Date.now() + 60000 });
  let finish!: (r: Response) => void;
  const network = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(() => new Promise<Response>(resolve => { finish = resolve; }));
  const pending = lease.request("/api/img/photo", { method: "HEAD" }, network);
  lease.revoke();
  finish(new Response(null, { status: 404 }));
  await expect(pending).rejects.toThrow();
  await expect(lease.request("/api/img/photo", { method: "PUT", body: "private" }, network)).rejects.toThrow();
  expect(network).toHaveBeenCalledTimes(1);
  expect(new Headers(network.mock.calls[0][1]?.headers).get("X-Capture-Owner")).toBe("A");
});

it("does not PUT bytes after a held HEAD completes under a revoked lifetime", async () => {
  const lease = new OwnershipLifetime({ owner: "A", expiresAt: Date.now() + 60000 });
  let finish!: (r: Response) => void;
  const network = vi.fn(() => new Promise<Response>(resolve => { finish = resolve; }));
  const pending = ensureHubImage("photo", "A bytes", (url, init) => lease.request(url, init, network));
  lease.revoke();
  finish(new Response(null, { status: 404 }));
  await expect(pending).rejects.toThrow();
  expect(network).toHaveBeenCalledTimes(1);
});

it("rejects delayed JSON bodies, not only aborted fetches", async () => {
  const lease = new OwnershipLifetime({ owner: "A", expiresAt: Date.now() + 60000 });
  let finish!: (body: object) => void;
  const raw = Response.json({});
  raw.json = () => new Promise(resolve => { finish = resolve; });
  const response = await lease.request("/api/sync", {}, async () => raw);
  const body = response.json();
  lease.revoke();
  finish({ board: "A private" });
  await expect(body).rejects.toThrow();
});

it("revokes at expiry and on other-tab auth transitions", async () => {
  vi.useFakeTimers();
  try {
    for (const trigger of ["expiry", "storage"] as const) {
      const lease = new OwnershipLifetime({ owner: "A", expiresAt: Date.now() + 100 });
      const stop = lease.watch(async () => ({ owner: "A", expiresAt: Date.now() + 100 }));
      if (trigger === "expiry") await vi.advanceTimersByTimeAsync(101);
      else window.dispatchEvent(new StorageEvent("storage", { key: "sb-project-auth-token" }));
      expect(lease.snapshot()).toBe("revoked");
      expect(lease.controller.signal.aborted).toBe(true);
      stop();
    }
  } finally { vi.useRealTimers(); }
});

it("hides and blocks work while revalidating on resume; a different account can never resume", async () => {
  const lease = new OwnershipLifetime({ owner: "A", expiresAt: Date.now() + 60000 });
  let finish!: (value: { owner: string; expiresAt: number }) => void;
  const stop = lease.watch(() => new Promise(resolve => { finish = resolve; }));
  try {
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    expect(lease.snapshot()).toBe("checking");
    // Local operations remain pinned to A while the board is hidden; network
    // work must wait, rather than silently lose a capture during revalidation.
    const network = vi.fn(async () => Response.json({ ok: true }));
    const queued = lease.request("/api/sort", { method: "POST", body: "A capture" }, network);
    expect(network).not.toHaveBeenCalled();
    finish({ owner: "A", expiresAt: Date.now() + 60000 });
    await Promise.resolve();
    expect(lease.snapshot()).toBe("active");
    await queued;
    expect(network).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event("focus"));
    finish({ owner: "B", expiresAt: Date.now() + 60000 });
    await Promise.resolve();
    expect(lease.snapshot()).toBe("revoked");
    window.dispatchEvent(new Event("focus"));
    expect(lease.snapshot()).toBe("revoked");
  } finally { stop(); }
});

it.each([401, 412, 428])("revokes on server auth/precondition rejection %s", async (status) => {
  const lease = new OwnershipLifetime({ owner: "A", expiresAt: Date.now() + 60000 });
  await expect(lease.request("/api/cloud/subscription", {}, async () => new Response(null, { status }))).rejects.toThrow();
  expect(lease.snapshot()).toBe("revoked");
});

it("a pending poll cannot renew an expired lease even when the expiry timer was throttled", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  const now = Date.now();
  const lease = new OwnershipLifetime({ owner: "A", expiresAt: now + 60000 });
  let finish!: (value: { owner: string; expiresAt: number }) => void;
  const stop = lease.watch(() => new Promise(resolve => { finish = resolve; }));
  try {
    await vi.advanceTimersByTimeAsync(30000);
    expect(lease.snapshot()).toBe("active");
    vi.spyOn(Date, "now").mockReturnValue(now + 60001);
    finish({ owner: "A", expiresAt: now + 120000 });
    await Promise.resolve();
    expect(lease.snapshot()).toBe("revoked");
    expect(() => lease.assertDisclosure()).toThrow();
  } finally { stop(); vi.restoreAllMocks(); vi.useRealTimers(); }
});

it("routine polls hold requests and readback and deny disclosure without hiding the verified UI", async () => {
  vi.useFakeTimers();
  const lease = new OwnershipLifetime({ owner: "A", expiresAt: Date.now() + 60000 });
  let finish!: (value: { owner: string; expiresAt: number }) => void;
  const stop = lease.watch(() => new Promise(resolve => { finish = resolve; }));
  const network = vi.fn(async () => Response.json({ private: "A" }));
  try {
    const response = await lease.request("/api/sync", {}, network);
    for (let cycle = 0; cycle < 4; cycle++) {
      await vi.advanceTimersByTimeAsync(30000);
      expect(lease.snapshot()).toBe("active");
      expect(() => lease.assertDisclosure()).toThrow("verification pending");
      expect(() => lease.assertOnline()).toThrow();
      const sent = network.mock.calls.length;
      const queued = lease.request("/api/sync", {}, network);
      const read = vi.fn();
      const body = (cycle === 0 ? response.json() : Promise.resolve()).then(read);
      await Promise.resolve();
      expect(network).toHaveBeenCalledTimes(sent);
      if (cycle === 0) expect(read).not.toHaveBeenCalled();
      finish({ owner: "A", expiresAt: Date.now() + 60000 });
      await queued;
      await body;
      expect(network).toHaveBeenCalledTimes(sent + 1);
      expect(lease.snapshot()).toBe("active");
      expect(() => lease.assertDisclosure()).not.toThrow();
    }
  } finally { stop(); vi.useRealTimers(); }
});

it("expires synchronously even before a throttled expiry timer runs", () => {
  const lease = new OwnershipLifetime({ owner: "A", expiresAt: Date.now() - 1 });
  expect(() => lease.assert()).toThrow();
  expect(lease.active).toBe(false);
});
