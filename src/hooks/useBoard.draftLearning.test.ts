// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { get, set } from "@/lib/storage";
import { EMPTY, KEY } from "@/lib/model";
import { useBoard } from "@/hooks/useBoard";
import { undoRule } from "@/lib/refiled";

const ai = vi.hoisted(() => ({ generateObject: vi.fn(), generateText: vi.fn() }));
vi.mock("ai", () => ai);
vi.mock("@/lib/clientIp", () => ({ clientIp: () => "synthetic" }));
vi.mock("@/lib/limiter", () => ({ modelRateLimit: () => ({ allowed: true }) }));
vi.mock("@/lib/providers", () => ({
  NoProvidersError: class extends Error {},
  sanitizeProviderError: () => "synthetic failure",
  withFallback: async (call: (tier: object) => Promise<unknown>) => ({
    value: await call({ model: "mock-no-provider" }),
    via: "mock-no-provider",
  }),
}));

import { POST } from "@/app/api/sort/route";

const raw = "From now on I will run twice every week for thirty minutes and track the training schedule.";
const paraphrase = "I am planning two weekly runs and want the training routine collected here.";
const calls: { raw: string; corrections?: { capture: string; chosenKind: string }[]; force?: string }[] = [];
const responseKinds: string[] = [];
let hook: ReturnType<typeof renderHook<ReturnType<typeof useBoard>, unknown>>;
let sortCall = 0;

const intention = (clean: string) => ({
  clean,
  title: "Training schedule",
  thinking: [],
  actions: [],
  intention: clean,
  shelfLife: "keep",
  due: null,
});

const thinking = (clean: string) => ({
  clean,
  title: "Training schedule",
  thinking: [{ text: clean, threadId: "r0", threadName: null }],
  actions: [],
  intention: null,
  shelfLife: "keep",
  due: null,
});

beforeEach(async () => {
  calls.length = 0;
  responseKinds.length = 0;
  sortCall = 0;
  ai.generateObject.mockReset();
  ai.generateObject.mockImplementation(async ({ schema }) => {
    sortCall += 1;
    return { object: schema.parse(sortCall === 1 ? intention(raw) : thinking(sortCall === 2 ? raw : paraphrase)) };
  });
  vi.stubGlobal("fetch", vi.fn(async (input, init) => {
    if (String(input) === "/api/sort") {
      const body = JSON.parse(String(init?.body));
      calls.push(body);
      const response = await POST(new Request("http://localhost/api/sort", {
        method: "POST",
        body: String(init?.body),
      }));
      responseKinds.push((await response.clone().json()).kind);
      return response;
    }
    if (String(input) === "/api/intention") {
      return Response.json({ expandedIntention: "Synthetic expansion", recommendedActions: [], counterIntentions: [] });
    }
    if (String(input) === "/api/summarize") return Response.json({ summary: "Synthetic summary" });
    return new Response(null, { status: 503 });
  }));
  await set(KEY, JSON.stringify({
    ...EMPTY,
    principles: [],
    threads: [{
      id: "training",
      name: "Training schedule",
      summary: "",
      frags: [{ id: "seed", at: Date.now(), text: "Training schedule" }],
    }],
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function submit(value = raw) {
  await act(async () => {
    await hook.result.current.submit(false, undefined, value);
  });
}

it("a corrected draft becomes semantic training evidence after reload", async () => {
  hook = renderHook(() => useBoard(Date.now()));
  await waitFor(() => expect(hook.result.current.loaded).toBe(true));
  await submit();
  expect(hook.result.current.draft?.rawInput).toBe(raw);

  await act(async () => {
    await hook.result.current.draftToThread();
  });
  expect(hook.result.current.draft).toBeNull();
  expect(hook.result.current.data.threads.find((thread) => thread.id === "training")?.frags.at(-1)?.text).toBe(raw);

  const saved = JSON.parse((await get(KEY))!);
  expect(saved.corrections).toHaveLength(1);
  expect(saved.corrections[0]).toMatchObject({
    context: raw,
    chosenKind: "thread",
    rule: undoRule(raw, "intention", "thread"),
  });

  hook.unmount();
  hook = renderHook(() => useBoard(Date.now()));
  await waitFor(() => expect(hook.result.current.loaded).toBe(true));
  await submit(paraphrase);

  expect(calls.at(-1)?.corrections).toContainEqual(expect.objectContaining({
    capture: raw,
    chosenKind: "thread",
  }));
  expect(hook.result.current.draft).toBeNull();
  expect(responseKinds).toEqual(["intention", "thread", "thread"]);
});

it("legacy phrase rules cannot override the model's semantic interpretation", async () => {
  ai.generateObject.mockImplementation(async ({ schema }) => ({
    object: schema.parse({
      clean: raw,
      title: "Run twice weekly",
      thinking: [],
      actions: [{ text: "Run twice every week for thirty minutes", sourceText: raw, thinkingIndex: null, shelfLife: "keep", due: null }],
      intention: null,
      shelfLife: "keep",
      due: null,
    }),
  }));
  const response = await POST(new Request("http://localhost/api/sort", {
    method: "POST",
    body: JSON.stringify({
      raw,
      localDate: "2026-09-23",
      timeZone: "UTC",
      rules: [undoRule(raw, "action", "thread")],
      threads: [{ id: "training", name: "Training schedule", about: "training schedule" }],
    }),
  }));

  expect(response.status).toBe(200);
  expect((await response.json()).kind).toBe("action");
});

it("Undo preserves the structured correction while restoring the words", async () => {
  hook = renderHook(() => useBoard(Date.now()));
  await waitFor(() => expect(hook.result.current.loaded).toBe(true));
  await submit();
  await act(async () => {
    await hook.result.current.draftToThread();
  });
  await act(async () => {
    await hook.result.current.undo();
  });

  expect(hook.result.current.text).toBe(raw);
  expect(hook.result.current.data.threads.find((thread) => thread.id === "training")?.frags).toHaveLength(1);
  expect(hook.result.current.data.ledger?.some((entry) => entry.raw === raw)).toBe(true);
  expect(hook.result.current.data.corrections?.some((entry) => (
    entry.chosenKind === "thread" && entry.context === raw
  ))).toBe(true);
});