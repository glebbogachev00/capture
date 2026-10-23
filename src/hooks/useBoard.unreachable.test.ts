// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as storage from "@/lib/storage";
import { CORRUPT, EMPTY, KEY } from "@/lib/model";
import { MANUAL_ROUTING_UNDO_KEY } from "@/lib/manualRoutingUndo";
import { PENDING_RECOVERY_KEY } from "@/lib/pendingRecovery";
import { TOMBSTONE_KEY } from "@/lib/sync";
import { useBoard } from "./useBoard";
import { WAITING_TO_SORT } from "./useWaitingCaptures";
import { stubSortFetch } from "../../test/simpleSortFetch";

/* The same checks, at test speed: ask after 50ms instead of 6s, recheck every 100ms. */
vi.mock("@/lib/reachability", async (load) => {
  const actual = await load<typeof import("@/lib/reachability")>();
  class Fast extends actual.Reachability {
    watch(unreachable: () => void) { return super.watch(unreachable, 50); }
  }
  return { ...actual, Reachability: Fast, RECHECK_EVERY_MS: 100 };
});

beforeEach(async () => {
  await storage.del(CORRUPT);
  await storage.del(PENDING_RECOVERY_KEY);
  await storage.del(MANUAL_ROUTING_UNDO_KEY);
  await storage.set(KEY, JSON.stringify({ ...EMPTY, principles: [], threads: [] }));
  await storage.set(TOMBSTONE_KEY, "[]");
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("a capture made while the server is silent shows as saved and waiting, then sorts itself when it answers", { timeout: 20_000 }, async () => {
  let reachable = false;
  const sorts: string[] = [];
  stubSortFetch(async (url: unknown, init?: RequestInit) => {
    const path = String(url);
    if (!reachable && (path === "/api/version" || path === "/api/sort")) {
      /* A VPN that dropped: the request never comes back, until it is given up on. */
      return new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
    }
    if (path === "/api/version") return Response.json({ build: "test" });
    if (path === "/api/sort") {
      sorts.push(JSON.parse(String(init?.body)).raw);
      return Response.json({ sort: { version: 2, items: [{ kind: "action", text: "Water the basil" }] }, via: "test" });
    }
    return new Response(null, { status: 503 });
  });
  const hook = renderHook(() => useBoard(Date.now()));
  await waitFor(() => expect(hook.result.current.loaded).toBe(true));

  act(() => hook.result.current.setText("Water the basil tomorrow"));
  await act(async () => { await hook.result.current.submit(); });

  /* Within seconds, not a minute (the silent check waits out its 4s): saved, visible, saying why. */
  await waitFor(() => expect(hook.result.current.waitingIds).toHaveLength(1), { timeout: 8000 });
  const [waiting] = hook.result.current.waitingIds;
  expect(hook.result.current.unsorted.map((action) => action.id)).toContain(waiting);
  expect(hook.result.current.autoSortingIds).not.toContain(waiting);
  expect(hook.result.current.landed).toBe(WAITING_TO_SORT());
  expect(hook.result.current.err).toBeFalsy();

  /* The server answers again: it sorts without anyone pressing anything. */
  reachable = true;
  await waitFor(() => expect(hook.result.current.waitingIds).toHaveLength(0), { timeout: 8000 });
  await waitFor(() => expect(hook.result.current.data.actions.find((action) => action.text === "Water the basil" && !action.unsorted)).toBeTruthy(), { timeout: 3000 });
  expect(sorts).toEqual(["Water the basil tomorrow"]);
});

it("a server that refuses the connection outright is waited for too, not reported as a failed sort", { timeout: 20_000 }, async () => {
  let reachable = false;
  stubSortFetch(async (url: unknown) => {
    const path = String(url);
    if (!reachable && (path === "/api/version" || path === "/api/sort")) throw new TypeError("Failed to fetch");
    if (path === "/api/version") return Response.json({ build: "test" });
    if (path === "/api/sort") return Response.json({ sort: { version: 2, items: [{ kind: "action", text: "Call the bank" }] }, via: "test" });
    return new Response(null, { status: 503 });
  });
  const hook = renderHook(() => useBoard(Date.now()));
  await waitFor(() => expect(hook.result.current.loaded).toBe(true));
  act(() => hook.result.current.setText("Call the bank"));
  await act(async () => { await hook.result.current.submit(); });
  await waitFor(() => expect(hook.result.current.waitingIds).toHaveLength(1), { timeout: 3000 });
  expect(hook.result.current.err).toBeFalsy();
  expect(hook.result.current.landed).toBe(WAITING_TO_SORT());
  reachable = true;
  await waitFor(() => expect(hook.result.current.data.actions.find((action) => action.text === "Call the bank" && !action.unsorted)).toBeTruthy(), { timeout: 5000 });
});
