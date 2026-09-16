// @vitest-environment jsdom
import "fake-indexeddb/auto";
import * as React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { Board } from "@/lib/model";
import type { SyncState } from "@/lib/sync";

vi.doMock("react", () => React);
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function openBoard(owner: string, read: () => Promise<Response>) {
  vi.resetModules(); localStorage.clear();
  const own = await import("@/lib/ownership");
  own.installDocumentLifetime({ owner, expiresAt: Date.now() + 60000 });
  const { EMPTY, KEY } = await import("@/lib/model");
  const { TOMBSTONE_KEY } = await import("@/lib/sync");
  const storage = await import("@/lib/storage");
  const now = Date.now();
  const saved: Board = {
    ...EMPTY,
    threads: [{ id: "local-thread", name: "Pending local note", summary: "", frags: [], updatedAt: 0 }],
    ledger: [{ id: "local-record", at: now, raw: "Original words", clean: "Original words", kind: "thread", source: "typed", targetId: "local-thread" }],
    completions: [{ id: "finished", text: "Finished locally", at: now }],
  };
  await storage.set(KEY, JSON.stringify(saved));
  await storage.set(TOMBSTONE_KEY, "[]");
  const posts: SyncState[] = [];
  const network = vi.fn(async (input: unknown, init?: RequestInit) => {
    if (!String(input).startsWith("/api/sync")) throw new Error(`Unexpected HTTP: ${input}`);
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as SyncState;
      posts.push(body);
      return Response.json({ ...body, rev: 2 });
    }
    return read();
  });
  vi.stubGlobal("fetch", network);
  const { useBoard } = await import("./useBoard");
  const hook = renderHook(() => useBoard(now));
  await waitFor(() => expect(hook.result.current.loaded).toBe(true));
  await act(async () => { await Promise.resolve(); });
  return { hook, posts, saved, EMPTY, network, persisted: async () => JSON.parse((await storage.get(KEY))!) as Board };
}

it.each([402, 503, "network"] as const)("failed initial GET (%s) never POSTs or loses pending edits/history", async failure => {
  const read = async () => {
    if (failure === "network") throw new TypeError("Failed to fetch");
    return new Response(null, { status: failure });
  };
  const { hook, posts, saved, persisted } = await openBoard(`failed-${failure}`, read);
  expect(posts).toHaveLength(0);
  expect(hook.result.current.sync?.ok).toBe(false);
  await act(async () => { await hook.result.current.renameThread("local-thread", "Edited while hub unavailable"); });
  await act(async () => { await hook.result.current.syncNow(); });
  // A previously scheduled local-edit debounce must not bypass the first-read gate.
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 1300)); });
  expect(posts).toHaveLength(0);
  for (const board of [hook.result.current.data, await persisted()]) {
    expect(board.threads[0].name).toBe("Edited while hub unavailable");
    expect(board.ledger).toEqual(saved.ledger);
    expect(board.completions).toEqual(saved.completions);
  }
});

it("successful zero-change initial merge still flushes saved local edits", async () => {
  const { EMPTY } = await import("@/lib/model");
  const { posts, saved, hook } = await openBoard("unchanged-merge", async () => Response.json({ board: EMPTY, tombstones: [], rev: 1 }));
  await waitFor(() => expect(posts).toHaveLength(1));
  const { adoptHubState } = await import("@/lib/adopt");
  expect(adoptHubState({ board: saved, tombstones: [] }, { board: EMPTY, tombstones: [] }).changed).toBe(false);
  expect(posts[0].board.threads).toEqual(saved.threads);
  expect(posts[0].board.ledger).toEqual(saved.ledger);
  expect(hook.result.current.sync?.ok).toBe(true);
});

it("successful revision-unchanged read still flushes a new local edit", async () => {
  const { EMPTY } = await import("@/lib/model");
  let reads = 0;
  const { hook, posts, network, saved } = await openBoard("revision-unchanged", async () => Response.json(++reads === 1
    ? { board: EMPTY, tombstones: [], rev: 1 }
    : { unchanged: true, rev: 2 }));
  await waitFor(() => expect(posts).toHaveLength(1));
  await act(async () => { await hook.result.current.renameThread("local-thread", "New local edit"); });
  await act(async () => { await hook.result.current.syncNow(); });
  expect(network.mock.calls.some(([url, init]) => url === "/api/sync?rev=2" && !init?.method)).toBe(true);
  expect(posts).toHaveLength(2);
  expect(posts[1].board.threads[0].name).toBe("New local edit");
  expect(posts[1].board.ledger).toEqual(saved.ledger);
  // Normal edits still use the governor after a successful initial read.
  await act(async () => { await hook.result.current.renameThread("local-thread", "Debounced edit"); });
  await waitFor(() => expect(posts).toHaveLength(3), { timeout: 2500 });
  expect(posts[2].board.threads[0].name).toBe("Debounced edit");
});

it("a later successful no-change pull retries pending edits after an initial failure", async () => {
  let available = false;
  const { EMPTY } = await import("@/lib/model");
  const { hook, posts, saved } = await openBoard("retry-unchanged", async () => available
    ? Response.json({ board: EMPTY, tombstones: [], rev: 1 })
    : new Response(null, { status: 503 }));
  expect(posts).toHaveLength(0);
  available = true;
  act(() => window.dispatchEvent(new Event("focus")));
  await waitFor(() => expect(posts).toHaveLength(1), { timeout: 2500 });
  expect(posts[0].board.threads).toEqual(saved.threads);
  expect(posts[0].board.ledger).toEqual(saved.ledger);
  await act(async () => { await hook.result.current.syncNow(); });
  expect(posts).toHaveLength(2);
});

it("reconnect merges the remote history before sending retained local edits", async () => {
  let available = false;
  const { EMPTY } = await import("@/lib/model");
  const now = Date.now();
  const remote: Board = { ...EMPTY,
    threads: [{ id: "remote-thread", name: "Other device note", summary: "", frags: [] }],
    ledger: [{ id: "remote-record", at: now, raw: "Other device history", clean: "Other device history", kind: "thread", source: "typed", targetId: "remote-thread" }],
  };
  const { hook, posts, saved, persisted } = await openBoard("reconnect-merge", async () => available
    ? Response.json({ board: remote, tombstones: [], rev: 1 })
    : new Response(null, { status: 402 }));
  expect(posts).toHaveLength(0);
  await act(async () => { await hook.result.current.renameThread("local-thread", "Pending edited note"); });
  available = true;
  act(() => window.dispatchEvent(new Event("online")));
  await waitFor(() => expect(posts.length).toBeGreaterThan(0), { timeout: 2500 });
  for (const board of [posts[0].board, hook.result.current.data, await persisted()]) {
    expect(board.threads.map(t => t.name)).toEqual(expect.arrayContaining(["Pending edited note", "Other device note"]));
    expect(board.ledger).toEqual(expect.arrayContaining([...saved.ledger, ...remote.ledger]));
    expect(board.completions).toEqual(saved.completions);
  }
});
