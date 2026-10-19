import { afterEach, expect, it, vi } from "vitest";

const ai = vi.hoisted(() => ({ generateObject: vi.fn(), generateText: vi.fn() }));
vi.mock("ai", () => ai);
vi.mock("@/lib/clientIp", () => ({ clientIp: () => "synthetic" }));
vi.mock("@/lib/limiter", () => ({ modelRateLimit: () => ({ allowed: true }) }));
vi.mock("@/lib/language.server", () => ({ inCaptureLanguage: async (items: unknown) => items }));
vi.mock("@/lib/actionText.server", () => ({ tightenActions: async (items: unknown) => items }));
vi.mock("@/lib/providers", () => ({
  NoProvidersError: class extends Error {},
  sanitizeProviderError: () => "synthetic provider rejection",
  withFallback: async (call: (tier: object) => Promise<unknown>) => ({ value: await call({ name: "mock", model: "mock" }), via: "mock" }),
}));
import { POST } from "@/app/api/sort/route";
import { SIMPLE_SORT_VERSION } from "@/lib/simpleSort";

afterEach(() => vi.resetAllMocks());

const threads = [{ id: "rcg", name: "Reality Creation Game", about: "A practice built on attention." }];
const sort = (raw: string) => POST(new Request("http://localhost/api/sort", {
  method: "POST",
  body: JSON.stringify({ raw, threads, sortVersion: SIMPLE_SORT_VERSION, latest: { rcg: "Why the wind-up bird book?" } }),
}));
const thought = (newThread: string | null, threadIds: string[] = []) =>
  ({ object: { items: [{ kind: "thought", text: "The wind-up bird points me.", threadIds, newThread, due: null, sameAsAction: null }] } });

it("files a would-be new thread into the one it continues, seeing each thread's latest note", async () => {
  ai.generateObject.mockResolvedValue(thought("Wind-up Bird"));
  ai.generateText.mockResolvedValue({ text: '{"threadId":"rcg"}' });
  const { sort: out } = await (await sort("The wind-up bird points me.")).json();
  expect(out.items[0].threads).toEqual([{ id: "rcg" }]);
  expect(ai.generateText.mock.calls[0][0].prompt).toContain("Why the wind-up bird book?");
});

it("leaves a thought the sort already filed in an existing thread", async () => {
  ai.generateObject.mockResolvedValue(thought(null, ["rcg"]));
  const { sort: out } = await (await sort("The wind-up bird points me.")).json();
  expect(ai.generateText).not.toHaveBeenCalled();
  expect(out.items[0].threads).toEqual([{ id: "rcg" }]);
});

it("keeps the new thread when the second look fails", async () => {
  ai.generateObject.mockResolvedValue(thought("Wind-up Bird"));
  ai.generateText.mockRejectedValue(new Error("provider down"));
  const { sort: out } = await (await sort("The wind-up bird points me.")).json();
  expect(out.items[0].threads).toEqual([{ name: "Wind-up Bird" }]);
});
