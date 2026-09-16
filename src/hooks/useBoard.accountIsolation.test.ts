// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { del, get, keys, set } from "@/lib/storage";
import { EMPTY, KEY, type Board } from "@/lib/model";
import { _clearImgCache, imgSave } from "@/lib/imgCache";
import * as React from "react";
import { createStorage } from "@/lib/storage";
import { OwnershipLifetime } from "@/lib/ownership";
// Each mount models a NEW document/module graph, not mutable global storage.
vi.doMock("react", () => React);

/** Security acceptance regressions against the verified document entry contract. These exercise the real hook, merge, image sync,
 * and fake IndexedDB; only HTTP/session identity is simulated. No live accounts.
 * The legacy store has no owner metadata: the test knows its provenance, but
 * the application must not silently infer ownership from whoever logs in next.
 */
const NOW = 1_789_286_400_000;
const secret = "Account A private capture";
const photo = "data:image/png;base64,QUFDQ09VTlRfQV9QUklWQVRF";
const aBoard: Board = {
  ...EMPTY,
  threads: [{ id: "a-thread", name: secret, summary: "",
    frags: [{ id: "a-frag", text: secret, at: NOW, imgs: ["a-photo"] }] }],
} as Board;
let account: "A" | "B" | null;
let posts: { account: typeof account; body: string }[];
let images: { account: typeof account; body: string }[];
let holdPull: ((response: Response) => void) | null;
let holdNextPull: boolean;

beforeEach(async () => {
  localStorage.clear();
  for (const key of await keys()) await del(key);
  _clearImgCache();
  for (const owner of ["A", "B", null]) {
    const store = createStorage(new OwnershipLifetime({ owner, expiresAt: Date.now() + 60000 }));
    for (const key of await store.keys()) await store.del(key);
  }
  account = "A";
  posts = [];
  images = [];
  holdPull = null;
  holdNextPull = false;
  await set(KEY, JSON.stringify(aBoard));
  await imgSave("a-photo", photo);
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/cloud/identity") return Response.json({ owner: account, expiresAt: Date.now() + 60000 });
    if (url === "/api/logout") { account = null; return Response.json({ ok: true }); }
    if (url === "/api/cloud/subscription") {
      return account ? Response.json({ tier: "cloud", captureLimit: null })
        : Response.json({ error: "unauthorized", captureLimit: 15 }, { status: 401 });
    }
    if (url.startsWith("/api/sync")) {
      if (!account) return Response.json({ error: "unauthorized" }, { status: 401 });
      if (init?.method === "POST") {
        posts.push({ account, body: String(init.body) });
        return Response.json({ ...JSON.parse(String(init.body)), rev: 2 });
      }
      if (holdNextPull) {
        holdNextPull = false;
        return new Promise<Response>((resolve) => { holdPull = resolve; });
      }
      return Response.json({ board: EMPTY, tombstones: [], rev: 1 });
    }
    if (url.startsWith("/api/img/")) {
      if (!account) return new Response(null, { status: 401 });
      if (init?.method === "HEAD") return new Response(null, { status: 404 });
      if (init?.method === "PUT") {
        images.push({ account, body: String(init.body) });
        return Response.json({ ok: true });
      }
      return new Response(null, { status: 404 });
    }
    return new Response(null, { status: 503 });
  }));
});
const cleanups: (() => void)[] = [];
afterEach(() => { cleanup(); for (const stop of cleanups.splice(0)) stop(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function mount() {
  vi.resetModules();
  const { installDocumentLifetime, verifyCloudIdentity } = await import("@/lib/ownership");
  const lifetime = installDocumentLifetime(await verifyCloudIdentity());
  const storage = await import("@/lib/storage");
  const { useBoard } = await import("./useBoard");
  const stop = lifetime.watch(verifyCloudIdentity);
  const hook = renderHook(() => useBoard(NOW));
  await waitFor(() => expect(hook.result.current.loaded).toBe(true));
  const unmount = () => { hook.unmount(); stop(); lifetime.revoke(); };
  cleanups.push(unmount);
  return { ...hook, unmount, lifetime, storage, stopWatching: stop };
}

it("preserves account-specific A -> B -> A boards without adopting anonymous data", async () => {
  const a = await mount();
  await act(async () => { await a.result.current.addPrinciple(secret, "A only"); });
  expect(JSON.stringify(a.result.current.data)).toContain(secret);
  const aImages = await import("@/lib/imgCache");
  await aImages.imgSave("same-id", photo);
  a.unmount();
  account = "B";
  const b = await mount();
  expect(JSON.stringify(b.result.current.data)).not.toContain(secret);
  const bImages = await import("@/lib/imgCache");
  expect(await bImages.imgLoad("same-id")).toBeNull();
  await bImages.imgSave("same-id", "data:image/png;base64,Qg==");
  await act(async () => { await b.result.current.addPrinciple("B private", "B only"); });
  b.unmount();
  account = "A";
  const again = await mount();
  expect(JSON.stringify(again.result.current.data)).toContain(secret);
  expect(JSON.stringify(again.result.current.data)).not.toContain("B private");
  const againImages = await import("@/lib/imgCache");
  expect(await againImages.imgLoad("same-id")).toBe(photo);
});

it("preserves the free anonymous board across documents and keeps it out of account sync", async () => {
  account = null;
  const anon = await mount();
  await act(async () => { await anon.result.current.addPrinciple("anonymous thought", "local"); });
  await act(async () => { await anon.result.current.syncNow(); });
  expect(posts).toEqual([]);
  anon.unmount();
  account = "B";
  const b = await mount();
  expect(JSON.stringify(b.result.current.data)).not.toContain("anonymous thought");
  await act(async () => { await b.result.current.syncNow(); });
  expect(posts.some(p => p.body.includes("anonymous thought"))).toBe(false);
  b.unmount();
  account = null;
  const again = await mount();
  expect(JSON.stringify(again.result.current.data)).toContain("anonymous thought");
});

it.each(["checking", "revoked", "focus", "online", "pageshow"])("%s blocks share, clipboard and a held asynchronous export", async (state) => {
  const disk = createStorage(new OwnershipLifetime({ owner: "A", expiresAt: Date.now() + 60000 }));
  await disk.set(KEY, JSON.stringify({ ...aBoard, actions: [{ id: "a-action", text: "Before edit", at: NOW }] }));
  const a = await mount();
  act(() => a.result.current.setTab("threads"));
  const backup = await import("@/lib/backup");
  const download = vi.spyOn(backup, "downloadJSON").mockImplementation(() => {});
  const share = vi.fn(async () => {});
  const writeText = vi.fn(async () => {});
  vi.stubGlobal("navigator", { share, clipboard: { writeText } });
  let finish!: (value: string | null) => void;
  const originalGet = a.storage.get;
  const read = vi.spyOn(a.storage, "get").mockImplementation(key => key === "capture:img:a-photo"
    ? new Promise(resolve => { finish = resolve; }) : originalGet(key));
  let exporting!: Promise<void>;
  await act(async () => { exporting = a.result.current.exportBoard(); });
  await waitFor(() => expect(finish).toBeDefined());
  const network = globalThis.fetch;
  vi.stubGlobal("fetch", vi.fn((url, init) => String(url) === "/api/cloud/identity"
    ? new Promise<Response>(() => {}) : network(url, init)));
  const ordinary = ["focus", "online", "pageshow"].includes(state);
  act(() => window.dispatchEvent(ordinary ? new Event(state) : new PageTransitionEvent("pageshow", { persisted: true })));
  expect(a.lifetime.snapshot()).toBe(ordinary ? "active" : "checking");
  expect(() => a.lifetime.assertDisclosure()).toThrow("verification pending");
  if (state === "revoked") act(() => a.lifetime.revoke());
  let editing: Promise<void> | undefined;
  await act(async () => {
    finish(photo);
    await exporting;
    await a.result.current.copyFragment("a-thread", "a-frag");
    await a.result.current.doShare();
    if (state !== "revoked") {
      a.result.current.setText("draft typed while pending");
      await a.result.current.addPrinciple("checking local write", "preserved");
      // The local edit lands now; its optional proofread must wait for identity.
      editing = a.result.current.editActionText("a-action", "edited while pending");
    }
  });
  expect(download).not.toHaveBeenCalled();
  expect(share).not.toHaveBeenCalled();
  expect(writeText).not.toHaveBeenCalled();
  if (state !== "revoked") {
    expect(a.result.current.text).toBe("draft typed while pending");
    expect(await disk.get(KEY)).toContain("checking local write");
    await waitFor(async () => expect(await disk.get(KEY)).toContain("edited while pending"));
    expect(() => a.lifetime.assertDisclosure()).toThrow("verification pending");
    act(() => a.lifetime.revoke());
    await act(async () => { await editing; });
  }
  read.mockRestore(); download.mockRestore();
});

it.each(["pending", "same-owner", "mismatch"])("routine poll %s gates clipboard, export and held-image share without hiding the board", async (resolution) => {
  const disk = createStorage(new OwnershipLifetime({ owner: "A", expiresAt: Date.now() + 60000 }));
  await disk.set(KEY, JSON.stringify(aBoard));
  const a = await mount();
  act(() => a.result.current.setOpen("a-thread"));
  const backup = await import("@/lib/backup");
  const download = vi.spyOn(backup, "downloadJSON").mockImplementation(() => {});
  const share = vi.fn(async () => {});
  const writeText = vi.fn(async () => {});
  vi.stubGlobal("navigator", { onLine: true, share, clipboard: { writeText } });
  const reads: ((value: string | null) => void)[] = [];
  const originalGet = a.storage.get;
  vi.spyOn(a.storage, "get").mockImplementation(key => key === "capture:img:a-photo"
    ? new Promise(resolve => { reads.push(resolve); }) : originalGet(key));
  let finish!: (response: Response) => void;
  const network = globalThis.fetch;
  const imageResponse = new Response(null);
  imageResponse.blob = async () => new Blob(["A photo"], { type: "image/png" });
  vi.stubGlobal("fetch", vi.fn((url, init) => String(url) === "/api/cloud/identity"
    ? new Promise<Response>(resolve => { finish = resolve; })
    : String(url) === photo ? Promise.resolve(imageResponse) : network(url, init)));
  let exporting!: Promise<void>;
  let sharing!: Promise<void>;
  await act(async () => { exporting = a.result.current.exportBoard(); sharing = a.result.current.doShare(); });
  expect(reads).toHaveLength(2);
  // Replace the real watcher before faking timers, keeping only one watcher.
  a.stopWatching();
  // Fake only intervals: IDB and the existing lease clock remain real.
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  const stop = a.lifetime.watch(() => fetch("/api/cloud/identity").then(r => r.json()));
  try {
    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    expect(a.lifetime.snapshot()).toBe("active");
    expect(JSON.stringify(a.result.current.data)).toContain(secret);
    await act(async () => { await a.result.current.copyFragment("a-thread", "a-frag"); });
    expect(writeText).not.toHaveBeenCalled();
    if (resolution !== "pending") {
      await act(async () => { finish(Response.json({ owner: resolution === "same-owner" ? "A" : "B", expiresAt: Date.now() + 60000 })); });
    }
    let shared = false;
    sharing.then(() => { shared = true; });
    await act(async () => {
      for (const read of reads) read(photo);
      await exporting;
      if (resolution !== "pending") await sharing;
    });
    if (resolution === "pending") {
      expect(download).not.toHaveBeenCalled();
      expect(share).not.toHaveBeenCalled();
      expect(shared).toBe(false);
      await act(async () => {
        finish(Response.json({ owner: "A", expiresAt: Date.now() + 60000 }));
        await sharing;
      });
      expect(share).toHaveBeenCalledTimes(1);
      expect(download).not.toHaveBeenCalled();
      await act(async () => { await a.result.current.copyFragment("a-thread", "a-frag"); });
      expect(writeText).toHaveBeenCalledWith(secret);
    } else if (resolution === "same-owner") {
      expect(download).toHaveBeenCalledTimes(1);
      expect(share).toHaveBeenCalledTimes(1);
      expect(share.mock.calls[0]).toEqual([expect.objectContaining({ files: [expect.any(File)] })]);
      await act(async () => { await a.result.current.copyFragment("a-thread", "a-frag"); });
      expect(writeText).toHaveBeenCalledWith(secret);
    } else {
      expect(download).not.toHaveBeenCalled();
      expect(share).not.toHaveBeenCalled();
      expect(writeText).not.toHaveBeenCalled();
      expect(a.lifetime.snapshot()).toBe("revoked");
    }
  } finally { stop(); vi.useRealTimers(); }
});

it("held hook native share cannot copy A after another tab revokes it", async () => {
  const disk = createStorage(new OwnershipLifetime({ owner: "A", expiresAt: Date.now() + 60000 }));
  await disk.set(KEY, JSON.stringify(aBoard));
  const a = await mount();
  act(() => a.result.current.setTab("threads"));
  let reject!: (error: Error) => void;
  const share = vi.fn(() => new Promise<void>((_, fail) => { reject = fail; }));
  const writeText = vi.fn(async () => {});
  vi.stubGlobal("navigator", { share, clipboard: { writeText } });
  let pending!: Promise<void>;
  await act(async () => { pending = a.result.current.doShare(); });
  expect(share).toHaveBeenCalledTimes(1);
  act(() => window.dispatchEvent(new StorageEvent("storage", { key: "capture:logout-pending", newValue: "other-tab" })));
  await act(async () => { reject(new Error("native failure")); await pending; });
  expect(writeText).not.toHaveBeenCalled();
  expect(a.lifetime.snapshot()).toBe("revoked");
});

it.each(["502", "network"])("failed logout (%s) never navigates or reopens old cookies after reload; retry preserves A", async (failure) => {
  const a = await mount();
  await act(async () => { await a.result.current.addPrinciple(secret, "A only"); });
  const cache = await import("@/lib/imgCache");
  await cache.imgSave("a-photo", photo);
  const location = { href: "/app" };
  vi.stubGlobal("location", location);
  const network = globalThis.fetch;
  vi.stubGlobal("fetch", vi.fn((url, init) => String(url) === "/api/logout"
    ? failure === "network" ? Promise.reject(new TypeError("offline")) : Promise.resolve(new Response(null, { status: 502 }))
    : network(url, init)));
  await act(async () => { await a.result.current.logout(); });
  expect(location.href).toBe("/app");
  expect(a.lifetime.snapshot()).toBe("revoked");
  expect(JSON.stringify(a.result.current.data)).not.toContain(secret);
  a.unmount();
  vi.resetModules();
  const fresh = await import("@/lib/ownership");
  await expect(fresh.verifyCloudIdentity()).rejects.toThrow(/logout/i);
  expect(() => fresh.installDocumentLifetime({ owner: "A", expiresAt: Date.now() + 60000 })).toThrow(/logout/i);
  expect(account).toBe("A");
  vi.stubGlobal("fetch", network);
  await fresh.logoutAndNavigate();
  expect(location.href).toBe("/login");
  expect(account).toBeNull();
  account = "A";
  const again = await mount();
  expect(JSON.stringify(again.result.current.data)).toContain(secret);
  const againCache = await import("@/lib/imgCache");
  expect(await againCache.imgLoad("a-photo")).toBe(photo);
});

it("logout revokes and hides the board before the logout request finishes", async () => {
  const a = await mount();
  await act(async () => { await a.result.current.addPrinciple(secret, "A only"); });
  const network = globalThis.fetch;
  vi.stubGlobal("fetch", vi.fn((url, init) => String(url) === "/api/logout"
    ? new Promise<Response>(() => {}) : network(url, init)));
  act(() => { void a.result.current.logout(); });
  expect(a.lifetime.snapshot()).toBe("revoked");
  expect(JSON.stringify(a.result.current.data)).not.toContain(secret);
  expect(a.lifetime.controller.signal.aborted).toBe(true);
});

it("rejects a stale AI continuation without rendering or persisting its result", async () => {
  const disk = createStorage(new OwnershipLifetime({ owner: "A", expiresAt: Date.now() + 60000 }));
  await disk.set(KEY, JSON.stringify(aBoard));
  const a = await mount();
  let complete!: (response: Response) => void;
  const network = globalThis.fetch;
  vi.stubGlobal("fetch", vi.fn((url, init) => String(url) === "/api/summarize"
    ? new Promise<Response>(resolve => { complete = resolve; }) : network(url, init)));
  let summary!: Promise<void>;
  await act(async () => { summary = a.result.current.editFrag("a-thread", "a-frag", "A corrected private text"); });
  await waitFor(() => expect(complete).toBeDefined());
  account = "B";
  act(() => window.dispatchEvent(new StorageEvent("storage", { key: "capture:auth-transition" })));
  await act(async () => { complete(Response.json({ summary: "STALE AI RESPONSE" })); await summary; });
  expect(JSON.stringify(a.result.current.data)).not.toContain(secret);
  expect(await disk.get(KEY)).not.toContain("STALE AI RESPONSE");
  expect(posts.filter(p => p.account === "B")).toEqual([]);
});

it("revocation cancels a queued hook push and blocks delayed restore writes", async () => {
  const a = await mount();
  await act(async () => { await a.result.current.addPrinciple(secret, "queued for sync"); });
  let completeRead!: (text: string) => void;
  const file = new File([""], "backup.json");
  Object.defineProperty(file, "text", { value: () => new Promise<string>(resolve => { completeRead = resolve; }) });
  let restore!: Promise<void>;
  await act(async () => { restore = a.result.current.restoreFromFile(file); });
  account = "B";
  act(() => window.dispatchEvent(new StorageEvent("storage", { key: "capture:auth-transition" })));
  const before = posts.length;
  await act(async () => {
    completeRead(JSON.stringify({ app: "capture", version: 2, board: { ...aBoard, threads: [{ ...aBoard.threads[0], name: "LATE RESTORE" }] } }));
    await restore;
    await new Promise(resolve => setTimeout(resolve, 1300));
  });
  expect(posts.length).toBe(before);
  expect(images.filter(p => p.account === "B")).toEqual([]);
  expect(JSON.stringify(a.result.current.data)).not.toContain(secret);
  const disk = createStorage(new OwnershipLifetime({ owner: "A", expiresAt: Date.now() + 60000 }));
  expect(await disk.get(KEY)).not.toContain("LATE RESTORE");
});

it("A -> logout -> B must not render A's unowned legacy board; original bytes remain recoverable", async () => {
  const a = await mount();
  a.unmount();
  await fetch("/api/logout", { method: "POST" });
  account = "B"; // successful B login in this browser
  const b = await mount();
  expect(JSON.stringify(b.result.current.data)).not.toContain(secret);
  expect(await get(KEY)).toContain(secret);
});

it("B must not upload A's board or cached photo after reopening and manual sync", async () => {
  account = "B";
  const b = await mount();
  await act(async () => { await b.result.current.syncNow(); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 100)); });
  expect.soft(posts.filter((p) => p.account === "B").some((p) => p.body.includes(secret))).toBe(false);
  expect.soft(images.filter((p) => p.account === "B").some((p) => p.body.includes(photo))).toBe(false);
});

it("signed-out free path must not expose a previous account's unknown legacy data", async () => {
  account = null;
  const anonymous = await mount();
  expect(JSON.stringify(anonymous.result.current.data)).not.toContain(secret);
  expect(await get(KEY)).toContain(secret);
});

it("an in-flight A pull must not start image uploads using B's new cookies", async () => {
  holdNextPull = true;
  const a = await mount();
  await waitFor(() => expect(holdPull).not.toBeNull());
  account = "B"; // another tab replaces the shared cookie session
  act(() => {
    window.dispatchEvent(new StorageEvent("storage", { key: "sb-test-auth-token", newValue: "new-session" }));
  });
  await act(async () => {
    holdPull!(Response.json({ board: aBoard, tombstones: [], rev: 1 }));
  });
  // Reconciliation is fire-and-forget; drain its real asynchronous IDB/HTTP work.
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 100)); });
  expect(images.filter((p) => p.account === "B")).toEqual([]);
  expect(JSON.stringify(a.result.current.data)).not.toContain(secret);
});
