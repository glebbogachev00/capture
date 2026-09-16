// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { OwnershipLifetime, resumeOfflineIdentity, OFFLINE_PERMISSION_KEY, LOGOUT_PENDING_KEY } from "./ownership";
import { createStorage } from "./storage";
beforeEach(() => localStorage.clear());
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("requires opt-in from an online verified account, then permits only local reads and edits after reload", async () => {
  const identity = { owner: "offline-A", expiresAt: Date.now() + 60000 };
  const online = new OwnershipLifetime(identity);
  expect(resumeOfflineIdentity()).toBeNull();
  online.keepOffline(true);
  const offline = new OwnershipLifetime(resumeOfflineIdentity()!);
  expect(offline.snapshot()).toBe("offline");
  const store = createStorage(offline);
  await store.set("board", "edited offline");
  expect(await store.get("board")).toBe("edited offline");
  const network = vi.fn();
  for (const url of ["/api/sync", "/api/img/photo", "/api/sort", "/api/transcribe"]) {
    await expect(offline.request(url, { method: "POST", body: "private" }, network)).rejects.toThrow();
  }
  expect(network).not.toHaveBeenCalled();
  expect(() => offline.keepOffline(true)).toThrow();
  expect(() => new OwnershipLifetime({ owner: null, expiresAt: identity.expiresAt }).keepOffline(true)).toThrow();
});
it.each([2 * 60 * 60 * 1000, 7 * 24 * 60 * 60 * 1000])("keeps local board and downloaded images editable after %i ms, without extending online auth", async (elapsed) => {
  const now = Date.now();
  const life = new OwnershipLifetime({ owner: `durable-${elapsed}`, expiresAt: now + 60000 });
  life.keepOffline(true);
  const initial = createStorage(life);
  await initial.set("board", "saved online");
  await initial.set("img:photo", "downloaded bytes");
  vi.spyOn(Date, "now").mockReturnValue(now + elapsed);
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  const identity = resumeOfflineIdentity();
  expect(identity?.owner).toBe(life.owner);
  const reopened = new OwnershipLifetime(identity!);
  const store = createStorage(reopened);
  expect(await store.get("board")).toBe("saved online");
  expect(await store.get("img:photo")).toBe("downloaded bytes");
  await store.set("board", "edited days later");
  expect(await createStorage(new OwnershipLifetime(resumeOfflineIdentity()!)).get("board")).toBe("edited days later");
  // Even the original open tab retains only LOCAL authority at JWT expiry.
  expect(await initial.get("board")).toBe("edited days later");
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  const network = vi.fn(async () => Response.json({ ok: true }));
  for (const document of [life, reopened]) {
    for (const url of ["/api/sync", "/api/img/photo", "/api/sort", "/api/transcribe"]) {
      await expect(document.request(url, { method: "POST", body: "private" }, network)).rejects.toThrow();
    }
  }
  expect(network).not.toHaveBeenCalled();
  const stop = reopened.watch(async () => ({ owner: life.owner, expiresAt: Date.now() + 60000 }));
  try {
    window.dispatchEvent(new Event("online"));
    await Promise.resolve();
    await reopened.request("/api/sync", {}, network);
    expect(network).toHaveBeenCalledTimes(1);
  } finally { stop(); }
});
it("does not silently upgrade old expiry-only consent or grant while disconnected", () => {
  localStorage.setItem(OFFLINE_PERMISSION_KEY, JSON.stringify({ owner: "A", expiresAt: Date.now() + 60000 }));
  expect(resumeOfflineIdentity()).toBeNull();
  localStorage.clear();
  const life = new OwnershipLifetime({ owner: "A", expiresAt: Date.now() + 60000 });
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  expect(() => life.keepOffline(true)).toThrow();
  expect(resumeOfflineIdentity()).toBeNull();
});
it.each(["disable", "other-tab-disable", "pending", "logout", "different", "rejection"])("days-old permission remains revocable: %s", async scenario => {
  const now = Date.now();
  const online = new OwnershipLifetime({ owner: "A", expiresAt: now + 60000 });
  online.keepOffline(true);
  vi.spyOn(Date, "now").mockReturnValue(now + 7 * 24 * 60 * 60 * 1000);
  const life = new OwnershipLifetime(resumeOfflineIdentity()!);
  const network = vi.fn(async () => Response.json({ ok: true }));
  const stop = life.watch(async () => {
    if (scenario === "rejection") throw new Error("server rejected identity");
    return { owner: "B", expiresAt: Date.now() + 60000 };
  });
  try {
    if (scenario === "disable") life.keepOffline(false);
    else if (scenario === "other-tab-disable") {
      localStorage.removeItem(OFFLINE_PERMISSION_KEY);
      window.dispatchEvent(new StorageEvent("storage", { key: OFFLINE_PERMISSION_KEY }));
    } else if (scenario === "pending") {
      localStorage.setItem(LOGOUT_PENDING_KEY, "failed-logout");
      expect(() => life.assert()).toThrow(); // no event/timer required
    } else if (scenario === "logout") {
      const { announceAuthTransition } = await import("./ownership");
      announceAuthTransition();
      expect(() => life.assert()).toThrow();
    } else {
      window.dispatchEvent(new Event("online"));
      await Promise.resolve();
    }
    expect(resumeOfflineIdentity()).toBeNull();
    await expect(createStorage(life).get("board")).rejects.toThrow();
    await expect(life.request("/api/sync", { method: "POST", body: "A" }, network)).rejects.toThrow();
    expect(network).not.toHaveBeenCalled();
  } finally { stop(); }
});
it("expiry timer retires only online authority and is renewed by same-account verification", async () => {
  vi.useFakeTimers();
  const life = new OwnershipLifetime({ owner: "A", expiresAt: Date.now() + 100 });
  life.keepOffline(true);
  const stop = life.watch(async () => ({ owner: "A", expiresAt: Date.now() + 100 }));
  try {
    await vi.advanceTimersByTimeAsync(101);
    expect(life.snapshot()).toBe("offline");
    expect(life.controller.signal.aborted).toBe(false);
    life.assertDisclosure();
    expect(() => life.assertOnline()).toThrow();
    window.dispatchEvent(new Event("online"));
    await Promise.resolve();
    life.assertOnline();
    await vi.advanceTimersByTimeAsync(101);
    expect(life.snapshot()).toBe("offline");
    expect(resumeOfflineIdentity()?.owner).toBe("A");
  } finally { stop(); vi.useRealTimers(); }
});
it("falls back only for confirmed offline transport failure, not HTTP, malformed, or online configuration errors", async () => {
  new OwnershipLifetime({ owner: "A", expiresAt: Date.now() + 60000 }).keepOffline(true);
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
  const { openCloudIdentity } = await import("./ownership");
  expect(await openCloudIdentity()).toMatchObject({ owner: "A", offline: true });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 401 })));
  await expect(openCloudIdentity()).rejects.toThrow();
  expect(resumeOfflineIdentity()).toBeNull();
});
it.each(["same", "different", "rejection", "transition", "pending"])("offline reconnect/revocation: %s", async (scenario) => {
  const identity = { owner: "A", expiresAt: Date.now() + 60000 };
  new OwnershipLifetime(identity).keepOffline(true);
  const life = new OwnershipLifetime(resumeOfflineIdentity()!);
  const stop = life.watch(async () => {
    if (scenario === "rejection") throw new Error("401");
    return { ...identity, owner: scenario === "different" ? "B" : "A" };
  });
  try {
    if (scenario === "transition") window.dispatchEvent(new StorageEvent("storage", { key: "capture:auth-transition" }));
    else if (scenario === "pending") {
      localStorage.setItem(LOGOUT_PENDING_KEY, "failed-logout");
      window.dispatchEvent(new StorageEvent("storage", { key: LOGOUT_PENDING_KEY }));
    } else {
      window.dispatchEvent(new Event("online"));
      await Promise.resolve();
    }
    expect(life.snapshot()).toBe(scenario === "same" ? "active" : "revoked");
    if (scenario !== "same") expect(resumeOfflineIdentity()).toBeNull();
  } finally { stop(); }
});
it("revokes offline permission on a rejected personal request and never stores tokens", async () => {
  const life = new OwnershipLifetime({ owner: "A", expiresAt: Date.now() + 60000 });
  life.keepOffline(true);
  expect(Object.keys(JSON.parse(localStorage.getItem(OFFLINE_PERMISSION_KEY)!))).toEqual(["owner", "policy"]);
  await expect(life.request("/api/sync", {}, async () => new Response(null, { status: 401 }))).rejects.toThrow();
  expect(resumeOfflineIdentity()).toBeNull();
});
