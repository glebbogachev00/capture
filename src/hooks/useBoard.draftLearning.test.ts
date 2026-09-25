// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { get, set } from "@/lib/storage";
import { EMPTY, KEY } from "@/lib/model";
import { useBoard } from "@/hooks/useBoard";


const ai = vi.hoisted(() => ({ generateObject: vi.fn(), generateText: vi.fn() }));
vi.mock("ai", () => ai);
vi.mock("@/lib/clientIp", () => ({ clientIp: () => "synthetic" }));
vi.mock("@/lib/limiter", () => ({ modelRateLimit: () => ({ allowed: true }) }));
vi.mock("@/lib/providers", () => ({
  NoProvidersError: class extends Error {}, sanitizeProviderError: () => "synthetic failure",
  withFallback: async (call: (tier: object) => Promise<unknown>) => ({ value: await call({ model: "mock-no-provider" }), via: "mock-no-provider" }),
}));
import { POST } from "@/app/api/sort/route";

const raw = "From now on I will run twice every week for thirty minutes and track the training schedule.";
const calls: { correctionExamples?: { capture: string; kind: string; threadId?: string }[]; force?: string }[] = [];
const responseKinds: string[] = [];
let hook: ReturnType<typeof renderHook<ReturnType<typeof useBoard>, unknown>>;
const providerResult = { clean: raw, kind: "thread", title: "Training schedule", actions: [], primaryActions: [], primaryText: null, threadId: "training", threadName: null, also: [], shelfLife: "keep", due: null };
beforeEach(async () => {
  calls.length = 0; responseKinds.length = 0;
  ai.generateObject.mockImplementation(async ({ schema }) => ({ object: schema.parse(providerResult) }));
  vi.stubGlobal("fetch", vi.fn(async (input, init) => {
    if (String(input) === "/api/sort") {
      const body = JSON.parse(init.body); calls.push(body);
      const response = await POST(new Request("http://localhost/api/sort", { method: "POST", body: init.body }));
      responseKinds.push((await response.clone().json()).kind);
      return response;
    }
    if (String(input) === "/api/intention") return Response.json({ expandedIntention: "Synthetic expansion", recommendedActions: [], counterIntentions: [] });
    if (String(input) === "/api/summarize") return Response.json({ summary: "Synthetic summary" });
    return new Response(null, { status: 503 });
  }));
  await set(KEY, JSON.stringify({ ...EMPTY, principles: [], threads: [{ id: "training", name: "Training schedule", summary: "", frags: [{ id: "seed", at: Date.now(), text: "Training schedule" }] }] }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function submit() { await act(async () => { await hook.result.current.submit(false, undefined, raw); }); }
it("persists and sends a bounded semantic correction after reload", async () => {
  hook = renderHook(() => useBoard(Date.now()));
  await waitFor(() => expect(hook.result.current.loaded).toBe(true));
  await submit();
  expect(hook.result.current.draft?.rawInput).toBe(raw);
  await act(async () => { await hook.result.current.draftToThread(); });
  expect(hook.result.current.draft).toBeNull();
  expect(hook.result.current.data.threads.find(t => t.id === "training")?.frags.at(-1)?.text).toBe(raw);
  expect(hook.result.current.canUndo).toBe(true);
  const saved = JSON.parse((await get(KEY))!);
  expect(saved.corrections).toHaveLength(1);
  expect(saved.corrections[0]).toMatchObject({
    context: raw,
    routing: { kind: "thread" },
  });
  expect(saved.corrections[0].rule).toBeUndefined();
  expect(saved.ledger.at(-1).raw).toBe(raw);
  hook.unmount();
  hook = renderHook(() => useBoard(Date.now()));
  await waitFor(() => expect(hook.result.current.loaded).toBe(true));
  await submit();
  expect(calls.at(-1)?.correctionExamples).toContainEqual(expect.objectContaining({
    capture: raw,
    kind: "thread",
  }));
  expect(hook.result.current.draft?.rawInput).toBe(raw);
  expect(responseKinds).toEqual(["intention", "thread", "intention"]);
});
it("a legacy phrase lesson cannot override the model response", async () => {
  ai.generateObject.mockImplementationOnce(async ({ schema }) => ({ object: schema.parse({ ...providerResult, kind: "intention", threadId: null }) }));
  const response = await POST(new Request("http://localhost/api/sort", { method: "POST", body: JSON.stringify({ raw, rules: ['Captures about "twice thirty" are a thread, not an intention'], threads: [{ id: "training", name: "Training schedule", about: "training schedule" }] }) }));
  expect(response.status).toBe(200);
  const out = await response.json();
  expect(out.kind).toBe("intention"); expect(out.threadId).toBeNull();
});
it("Undo restores the words after correcting an intention draft", async () => {
  hook = renderHook(() => useBoard(Date.now()));
  await waitFor(() => expect(hook.result.current.loaded).toBe(true));
  await submit();
  await act(async () => { await hook.result.current.draftToThread(); });
  await act(async () => { await hook.result.current.undo(); });
  expect(hook.result.current.text).toBe(raw);
  expect(hook.result.current.data.threads.find(t => t.id === "training")?.frags).toHaveLength(1);
  expect(hook.result.current.data.ledger?.some(entry => entry.raw === raw)).toBe(true);
  expect(hook.result.current.data.corrections?.some(entry =>
    entry.context === raw && entry.routing?.kind === "thread" && !entry.rule
  )).toBe(true);
});
