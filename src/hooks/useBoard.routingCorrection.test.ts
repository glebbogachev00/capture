// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EMPTY, KEY } from "@/lib/model";
import { set } from "@/lib/storage";
import { useBoard } from "./useBoard";

const raw = "The release handoff needs a clearer owner.";
const chosen = { id: "capture", name: "Capture", summary: "", frags: [{ id: "seed-c", at: 1, text: "Capture product" }] };
const wrong = { id: "operations", name: "Operations", summary: "", frags: [{ id: "seed-o", at: 1, text: "General operations" }] };

beforeEach(async () => {
  await set(KEY, JSON.stringify({ ...EMPTY, principles: [], threads: [chosen, wrong] }));
  vi.stubGlobal("fetch", vi.fn(async (input) => {
    const url = String(input);
    if (url === "/api/sort") return Response.json({
      clean: raw,
      kind: "thread",
      title: "Release handoff",
      actions: [],
      primaryActions: [],
      primaryText: null,
      shelfLife: "keep",
      due: null,
      threadId: "operations",
      threadName: null,
      also: [],
    });
    if (url === "/api/summarize") return Response.json({ summary: "Synthetic" });
    return new Response(null, { status: 503 });
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("keeps the explicitly selected correction destination authoritative for the current capture", async () => {
  const hook = renderHook(() => useBoard(Date.now()));
  await waitFor(() => expect(hook.result.current.loaded).toBe(true));

  await act(async () => { await hook.result.current.submit(false, undefined, raw); });
  expect(hook.result.current.data.threads.find((thread) => thread.id === "operations")?.frags.at(-1)?.text).toBe(raw);

  await act(async () => { await hook.result.current.undo(); });
  expect(hook.result.current.misfiled?.thread?.id).toBe("operations");

  await act(async () => { await hook.result.current.sortAgainIntoThread("capture"); });

  expect(hook.result.current.data.threads.find((thread) => thread.id === "capture")?.frags.at(-1)?.text).toBe(raw);
  expect(hook.result.current.data.threads.find((thread) => thread.id === "operations")?.frags).toHaveLength(1);
  expect(hook.result.current.data.corrections).toEqual(expect.arrayContaining([
    expect.objectContaining({
      context: raw,
      routing: { kind: "thread", threadId: "capture", threadName: "Capture" },
    }),
  ]));
});
