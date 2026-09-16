// @vitest-environment jsdom
import "fake-indexeddb/auto";
import * as React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { renderHook, act, cleanup, waitFor } from "@testing-library/react";
vi.doMock("react", () => React);
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("online cold reopen sends saved local changes even when the remote merge adds nothing", async () => {
  vi.resetModules(); localStorage.clear();
  const own = await import("@/lib/ownership");
  own.installDocumentLifetime({ owner: "online-reload", expiresAt: Date.now() + 60000 });
  const { EMPTY, KEY } = await import("@/lib/model");
  const { set } = await import("@/lib/storage");
  await set(KEY, JSON.stringify({ ...EMPTY, threads: [{ id: "offline-thread", name: "Saved before closing offline", summary: "", frags: [] }] }));
  const network = vi.fn(async (input: unknown, init?: RequestInit) => String(input).startsWith("/api/sync")
    ? Response.json(init?.method === "POST" ? { ...JSON.parse(String(init.body)), rev: 2 } : { board: EMPTY, tombstones: [], rev: 1 })
    : new Response(null, { status: 404 }));
  vi.stubGlobal("fetch", network);
  const { useBoard } = await import("./useBoard");
  renderHook(() => useBoard(Date.now()));
  await waitFor(() => expect(network.mock.calls.some(call => call[1]?.method === "POST" && String(call[1]?.body).includes("Saved before closing offline"))).toBe(true));
});
it("offline baseline: model-free capture, edit, find, manual move, downloaded photo and durable reload", async () => {
  vi.resetModules(); localStorage.clear();
  const own = await import("@/lib/ownership");
  const online = new own.OwnershipLifetime({ owner: "baseline", expiresAt: Date.now() + 60000 });
  online.keepOffline(true);
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 7 * 24 * 60 * 60 * 1000);
  own.installDocumentLifetime(own.resumeOfflineIdentity()!);
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  const network = vi.fn<(input?: unknown, init?: RequestInit) => Promise<Response>>(async () => { throw new Error("Personal network must not run"); });
  vi.stubGlobal("fetch", network);
  const { set, get } = await import("@/lib/storage");
  const { KEY, EMPTY, IMG } = await import("@/lib/model");
  await set(KEY, JSON.stringify({ ...EMPTY, threads: [
    { id: "one", name: "First", summary: "", frags: [{ id: "frag", at: Date.now(), text: "photo note", imgs: ["pic"] }] },
    { id: "two", name: "Second", summary: "", frags: [] },
  ] }));
  await set(IMG("pic"), "downloaded bytes");
  const { useBoard } = await import("./useBoard");
  const hook = renderHook(() => useBoard(Date.now()));
  await waitFor(() => expect(hook.result.current.loaded).toBe(true));
  act(() => hook.result.current.setText("Offline capture baseline"));
  await act(async () => { await hook.result.current.submit(); });
  const action = hook.result.current.data.actions.find(a => a.text === "Offline capture baseline")!;
  expect(action.unsorted).toBe(true);
  await act(async () => { await hook.result.current.editActionText(action.id, "Edited offline baseline"); });
  act(() => hook.result.current.setQuery("Edited offline"));
  await waitFor(() => expect(hook.result.current.hits.total).toBeGreaterThan(0));
  await act(async () => { await hook.result.current.moveFrag("one", "frag", "two"); });
  expect(hook.result.current.data.threads.find(t => t.id === "two")?.frags[0].text).toBe("photo note");
  expect(await get(IMG("pic"))).toBe("downloaded bytes");
  expect(hook.result.current.sync?.ok).toBe(false);
  expect(network).not.toHaveBeenCalled();
  hook.unmount();
  const reopened = renderHook(() => useBoard(Date.now()));
  await waitFor(() => expect(reopened.result.current.loaded).toBe(true));
  expect(reopened.result.current.data.actions.some(a => a.text === "Edited offline baseline")).toBe(true);
  expect(network).not.toHaveBeenCalled();
  const stop = own.getDocumentLifetime().watch(async () => ({ owner: "baseline", expiresAt: Date.now() + 60000 }));
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  network.mockImplementation(async (input?: unknown, init?: RequestInit) => {
    if (String(input).startsWith("/api/sync")) return Response.json(init?.method === "POST" ? { ...JSON.parse(String(init.body)), rev: 2 } : { board: EMPTY, tombstones: [], rev: 1 });
    return new Response(null, { status: 404 });
  });
  act(() => window.dispatchEvent(new Event("online")));
  await waitFor(() => expect(network.mock.calls.some(call => call[1]?.method === "POST" && String(call[1]?.body).includes("Edited offline baseline"))).toBe(true));
  stop();
});
