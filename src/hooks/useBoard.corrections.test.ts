// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { set } from "@/lib/storage";
import { EMPTY, KEY } from "@/lib/model";
import { useBoard } from "./useBoard";

const at = 1_756_000_000_000;
const requests: { name: string; frags: { text: string }[]; resolve: (body: object) => void }[] = [];
const proofreads: string[] = [];
beforeEach(async () => {
  requests.length = 0;
  proofreads.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (input, init) => {
    if (String(input) === "/api/summarize") {
      const body = JSON.parse(init.body);
      return new Promise<Response>((resolve) => requests.push({ ...body, resolve: (out) => resolve(Response.json(out)) }));
    }
    if (init?.body && String(init.body).includes('"proofread"')) {
      proofreads.push(String(init.body));
      return Response.json({ text: "AI rewrote the correction" });
    }
    return new Response(null, { status: 503 });
  }));
  await set(KEY, JSON.stringify({ ...EMPTY, principles: [], threads: [{ id: "t", name: "Old title", summary: "Old summary", belongs: "Old route", next: "Old step", frags: [{ id: "f", text: "Old text", at }] }] }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function mount() {
  const hook = renderHook(() => useBoard(at + 60_000));
  await waitFor(() => expect(hook.result.current.loaded).toBe(true));
  return hook;
}
it("rename clears obsolete metadata and regenerates against the explicit new title", async () => {
  const { result } = await mount();
  await act(async () => { result.current.renameThread("t", "Askde posting strategy"); });
  expect(result.current.data.threads[0].summary).toBe("");
  expect(result.current.data.threads[0].belongs).toBeUndefined();
  expect(result.current.data.threads[0].next).toBeNull();
  await waitFor(() => expect(requests).toHaveLength(1));
  expect(requests[0].name).toBe("Askde posting strategy");
  await act(async () => { requests[0].resolve({ summary: "New summary" }); });
  await waitFor(() => expect(result.current.data.threads[0].summary).toBe("New summary"));
  expect(result.current.data.threads[0].name).toBe("Askde posting strategy");
});

it.each(["edit", "rename"])("late automatic summary after a newer %s is rejected and clears progress", async (change) => {
  const { result } = await mount();
  let first!: Promise<void>;
  await act(async () => { first = result.current.editFrag("t", "f", "First correction"); });
  await waitFor(() => expect(requests).toHaveLength(1));
  let second!: Promise<void>;
  await act(async () => { second = change === "edit"
    ? result.current.editFrag("t", "f", "Newest correction")
    : result.current.renameThread("t", "Newest title"); });
  await waitFor(() => expect(requests).toHaveLength(2));
  await act(async () => { requests[0].resolve({ summary: "STALE" }); await first; });
  expect(result.current.data.threads[0].summary).not.toBe("STALE");
  expect(result.current.summarising).not.toBeNull();
  await act(async () => { requests[1].resolve({ summary: "CURRENT" }); await second; });
  expect(result.current.data.threads[0].summary).toBe("CURRENT");
  expect(result.current.summarising).toBeNull();
});

it("keeps summary progress until all overlapping requests settle, including rejected replies", async () => {
  const { result } = await mount();
  let first!: Promise<void>;
  await act(async () => { first = result.current.editFrag("t", "f", "First correction"); });
  await waitFor(() => expect(requests).toHaveLength(1));
  let second!: Promise<void>;
  await act(async () => { second = result.current.editFrag("t", "f", "Newest correction"); });
  await waitFor(() => expect(requests).toHaveLength(2));
  await act(async () => { requests[1].resolve({ summary: "CURRENT" }); await second; });
  expect(result.current.summarising).not.toBeNull();
  await act(async () => { requests[0].resolve({ summary: "STALE" }); await first; });
  expect(result.current.summarising).toBeNull();
  expect(result.current.data.threads[0].summary).toBe("CURRENT");
});

it("manual refresh cannot overwrite a summary from a newer correction", async () => {
  const { result } = await mount();
  let refresh!: Promise<void>;
  await act(async () => { refresh = result.current.refreshSummary("t"); });
  let edit!: Promise<void>;
  await act(async () => { edit = result.current.editFrag("t", "f", "Newest correction"); });
  await waitFor(() => expect(requests).toHaveLength(2));
  await act(async () => { requests[1].resolve({ summary: "CURRENT" }); await edit; });
  await act(async () => { requests[0].resolve({ summary: "STALE" }); await refresh; });
  expect(result.current.data.threads[0].summary).toBe("CURRENT");
  expect(result.current.busy).toBeNull();
});

it("a manual fragment correction is never submitted to automatic proofreading", async () => {
  const { result } = await mount();
  let pending!: Promise<void>;
  await act(async () => { pending = result.current.editFrag("t", "f", "Askde, exactly this spelling"); });
  await waitFor(() => expect(requests).toHaveLength(1));
  await act(async () => { requests[0].resolve({ summary: "Corrected summary" }); await pending; });
  expect(proofreads).toEqual([]);
  expect(result.current.data.threads[0].frags[0].text).toBe("Askde, exactly this spelling");
});
