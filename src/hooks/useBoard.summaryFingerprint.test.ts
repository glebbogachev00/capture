// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { set } from "@/lib/storage";
import { EMPTY, KEY } from "@/lib/model";
import { useBoard } from "./useBoard";

const at = 1_756_000_000_000;
const requests: { name: string; frags: { at: number; text: string }[]; resolve: (body: object) => void }[] = [];

beforeEach(async () => {
  requests.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (input, init) => {
    if (String(input) === "/api/summarize") {
      const body = JSON.parse(init.body);
      return new Promise<Response>((resolve) => requests.push({ ...body, resolve: (out) => resolve(Response.json(out)) }));
    }
    return new Response(null, { status: 503 });
  }));
  await set(KEY, JSON.stringify({ ...EMPTY, principles: [], threads: [{ id: "t", name: "Thread", summary: "Old summary", frags: [{ id: "f", text: "Old text", at }] }] }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it.each(["attach image", "resolve note"])("accepts the manual edit's only summary after %s while it is in flight", async (change) => {
  const { result } = renderHook(() => useBoard(at + 60_000));
  await waitFor(() => expect(result.current.loaded).toBe(true));
  let edit!: Promise<void>;
  await act(async () => { edit = result.current.editFrag("t", "f", "Corrected text"); });
  await waitFor(() => expect(requests).toHaveLength(1));
  expect(requests[0].name).toBe("Thread");
  expect(requests[0].frags).toEqual([{ at, text: "Corrected text" }]);
  expect(result.current.data.threads[0].summary).toBe("");

  await act(async () => {
    if (change === "attach image") {
      await result.current.addFragImages("t", "f", ["data:image/png;base64,aW1hZ2U="]);
    } else {
      await result.current.resolveFrag("t", "f");
    }
  });
  const changedFrag = result.current.data.threads[0].frags[0];
  if (change === "attach image") expect(changedFrag.imgs).toHaveLength(1);
  else expect(changedFrag.resolvedAt).toBeGreaterThan(0);
  expect(requests).toHaveLength(1);

  await act(async () => { requests[0].resolve({ summary: "Corrected summary", next: "Current next step" }); await edit; });
  expect(result.current.data.threads[0].summary).toBe("Corrected summary");
  expect(result.current.data.threads[0].next).toBe("Current next step");
  expect(result.current.data.threads[0].frags[0]).toEqual(changedFrag);
  expect(result.current.summarising).toBeNull();
  expect(requests).toHaveLength(1);
});
