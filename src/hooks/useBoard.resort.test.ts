// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY, IMG, KEY, type Board } from "@/lib/model";
import { settleUnsortedCapture } from "@/lib/settle";
import { get, set } from "@/lib/storage";
import { TOMBSTONE_KEY } from "@/lib/sync";
import type { SortResult } from "@/lib/boardOps";
import { useBoard } from "./useBoard";

const at = 1_756_000_000_000;
const raw = "A long offline capture whose picture and words must survive sorting.";
const image = "data:image/png;base64,c3ludGhldGlj";
const home = { id: "home", name: "Existing home", summary: "", frags: [] };
let outcome: SortResult;
let failSort = false;

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => { resolve = done; });
  return { promise, resolve };
}

async function seed(): Promise<void> {
  const base: Board = { ...EMPTY, principles: [], threads: [home] };
  const settled = settleUnsortedCapture(base, {
    raw,
    imgIds: ["pic"],
    at,
    dictated: false,
    openThreadId: "home",
  }, { itemId: "waiting", ledgerId: "record" });
  await set(KEY, JSON.stringify(settled.board));
  await set(TOMBSTONE_KEY, JSON.stringify([]));
  await set(IMG("pic"), image);
}

beforeEach(async () => {
  failSort = false;
  outcome = {
    kind: "thread",
    title: "Suggested elsewhere",
    clean: raw,
    actions: [],
    threadId: null,
    threadName: "Suggested elsewhere",
  };
  await seed();
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/sort") {
      return failSort
        ? Response.json({ error: "provider unavailable" }, { status: 503 })
        : Response.json(outcome);
    }
    if (url === "/api/intention") {
      return Response.json({
        expandedIntention: "I preserve what matters.",
        recommendedActions: [],
        counterIntentions: [],
      });
    }
    if (url === "/api/summarize") return Response.json({ summary: "Synthetic summary" });
    return new Response(null, { status: 404 });
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function mount() {
  const hook = renderHook(() => useBoard(at + 60_000));
  await waitFor(() => expect(hook.result.current.loaded).toBe(true));
  const waiting = hook.result.current.data.actions.find((action) => action.id === "waiting")!;
  return { ...hook, waiting };
}

describe("retrying a waiting-to-sort capture", () => {
  it("edits waiting words locally without calling a model", async () => {
    const hook = await mount();
    vi.mocked(fetch).mockClear();

    await act(async () => { await hook.result.current.editUnsorted("waiting", "Edited offline words"); });

    expect(hook.result.current.data.actions.find((action) => action.id === "waiting"))
      .toMatchObject({ text: "Edited offline words", src: "Edited offline words" });
    expect(hook.result.current.data.ledger.find((entry) => entry.id === "record"))
      .toMatchObject({ kind: "pending", raw: "Edited offline words", clean: "Edited offline words" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("deletes a waiting envelope and its local picture without exposing it", async () => {
    const hook = await mount();
    vi.mocked(fetch).mockClear();

    await act(async () => { await hook.result.current.removeUnsorted(hook.waiting); });

    expect(hook.result.current.data.actions.some((action) => action.id === "waiting")).toBe(false);
    expect(hook.result.current.data.ledger.find((entry) => entry.id === "record")?.undone).toBe(true);
    await waitFor(async () => expect(await get(IMG("pic"))).toBeNull());
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps the exact envelope when the provider still fails", async () => {
    failSort = true;
    const hook = await mount();

    await act(async () => { await hook.result.current.resort(hook.waiting); });

    expect(hook.result.current.data.actions.find((action) => action.id === "waiting"))
      .toEqual(hook.waiting);
    expect(hook.result.current.unsorted.map((action) => action.id)).toContain("waiting");
    expect(await get(IMG("pic"))).toBe(image);
  });

  it("honors the explicitly open thread and moves the picture there", async () => {
    const hook = await mount();

    await act(async () => { await hook.result.current.resort(hook.waiting); });

    expect(hook.result.current.data.actions.some((action) => action.id === "waiting")).toBe(false);
    expect(hook.result.current.data.threads).toHaveLength(1);
    expect(hook.result.current.data.threads[0].frags.at(-1)).toMatchObject({
      text: raw,
      imgs: ["pic"],
    });
    expect(hook.result.current.data.ledger.some((entry) =>
      entry.kind === "thread" && entry.targetId === "home"
    )).toBe(true);
    expect(await get(IMG("pic"))).toBe(image);
  });

  it("replaces the envelope with every explicit action while retaining the picture in a thread", async () => {
    outcome = {
      kind: "action",
      title: "Offline work",
      clean: raw,
      actions: ["First task", "Second task"],
      shelfLife: "keep",
      threadId: "model-choice",
      threadName: "Model choice",
    };
    const hook = await mount();

    await act(async () => { await hook.result.current.resort(hook.waiting); });

    expect(hook.result.current.data.actions.map((action) => action.text).sort())
      .toEqual(["First task", "Second task"]);
    expect(hook.result.current.data.actions.every((action) => !action.unsorted)).toBe(true);
    expect(hook.result.current.data.threads[0].frags.at(-1)?.imgs).toEqual(["pic"]);
    expect(hook.result.current.data.ledger.some((entry) =>
      entry.kind === "both" && entry.imgs?.includes("pic")
    )).toBe(true);
    expect(await get(IMG("pic"))).toBe(image);
  });

  it("handles a both result without leaving or duplicating the envelope", async () => {
    outcome = {
      kind: "both",
      title: "Offline thinking",
      clean: raw,
      primaryText: "The durable thought.",
      actions: ["Follow up"],
      primaryActions: ["Follow up"],
      threadId: "home",
      threadName: null,
    };
    const hook = await mount();

    await act(async () => { await hook.result.current.resort(hook.waiting); });

    expect(hook.result.current.data.actions).toHaveLength(1);
    expect(hook.result.current.data.actions[0]).toMatchObject({ text: "Follow up" });
    expect(hook.result.current.data.actions[0].unsorted).toBeFalsy();
    expect(hook.result.current.data.threads[0].frags.at(-1)).toMatchObject({
      text: "The durable thought.",
      imgs: ["pic"],
    });
  });

  it("opens an intention draft and removes the envelope only after save", async () => {
    outcome = {
      kind: "intention",
      title: "Preserve what matters",
      clean: raw,
      actions: [],
    };
    const hook = await mount();

    await act(async () => { await hook.result.current.resort(hook.waiting); });
    expect(hook.result.current.draft?.rawInput).toBe(raw);
    expect(hook.result.current.data.actions.some((action) => action.id === "waiting")).toBe(true);

    await act(async () => { await hook.result.current.saveDraft(); });
    expect(hook.result.current.data.actions.some((action) => action.id === "waiting")).toBe(false);
    expect(hook.result.current.data.intentions[0]).toMatchObject({ rawInput: raw, imgs: ["pic"] });
    expect(hook.result.current.data.ledger.some((entry) =>
      entry.kind === "intention" && entry.imgs?.includes("pic")
    )).toBe(true);
    expect(hook.result.current.data.ledger.find((entry) => entry.id === "record")?.imgs)
      .toEqual(["pic"]);
    expect(await get(IMG("pic"))).toBe(image);
  });

  it("rejects an intention response when the exact pending envelope changed in flight", async () => {
    outcome = {
      kind: "intention",
      title: "Preserve what matters",
      clean: raw,
      actions: [],
    };
    const intention = deferredResponse();
    const baseFetch = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation((input, init) =>
      String(input) === "/api/intention" ? intention.promise : baseFetch(input, init)
    );
    const hook = await mount();

    const sorting = hook.result.current.resort(hook.waiting);
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([input]) =>
      String(input) === "/api/intention"
    )).toBe(true));
    await act(async () => {
      await hook.result.current.editUnsorted("waiting", "Concurrent edit wins");
      intention.resolve(Response.json({
        expandedIntention: "Stale expansion",
        recommendedActions: [],
        counterIntentions: [],
      }));
      await sorting;
    });

    expect(hook.result.current.draft).toBeNull();
    expect(hook.result.current.data.actions.find((action) => action.id === "waiting"))
      .toMatchObject({ text: "Concurrent edit wins", unsorted: true });
    expect(hook.result.current.data.intentions).toEqual([]);
  });

  it("revalidates the exact pending envelope immediately before saving an intention", async () => {
    outcome = {
      kind: "intention",
      title: "Preserve what matters",
      clean: raw,
      actions: [],
    };
    const hook = await mount();
    await act(async () => { await hook.result.current.resort(hook.waiting); });
    expect(hook.result.current.draft?.expandedIntention).toBe("I preserve what matters.");

    await act(async () => {
      await hook.result.current.editUnsorted("waiting", "Synced edit after draft opened");
      await hook.result.current.saveDraft();
    });

    expect(hook.result.current.data.intentions).toEqual([]);
    expect(hook.result.current.data.actions.find((action) => action.id === "waiting"))
      .toMatchObject({ text: "Synced edit after draft opened", unsorted: true });
  });

  it("uses the existing envelope when an intention draft is corrected to a thread", async () => {
    outcome = {
      kind: "intention",
      title: "Preserve what matters",
      clean: raw,
      actions: [],
    };
    const hook = await mount();
    await act(async () => { await hook.result.current.resort(hook.waiting); });
    outcome = {
      kind: "thread",
      title: "Corrected thought",
      clean: raw,
      actions: [],
      threadId: "home",
      threadName: null,
    };

    await act(async () => { await hook.result.current.draftToThread(); });
    await waitFor(() => {
      expect(hook.result.current.data.actions.some((action) => action.id === "waiting")).toBe(false);
      expect(hook.result.current.data.threads).toHaveLength(1);
      expect(hook.result.current.data.threads[0].frags.at(-1)).toMatchObject({
        text: raw,
        imgs: ["pic"],
      });
    });
    expect(await get(IMG("pic"))).toBe(image);
  });
});
