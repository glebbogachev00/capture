import { expect, it, vi } from "vitest";
const ai = vi.hoisted(() => ({ generateObject: vi.fn(), generateText: vi.fn() }));
vi.mock("ai", () => ai);
vi.mock("@/lib/clientIp", () => ({ clientIp: () => "context-check" }));
vi.mock("@/lib/limiter", () => ({ modelRateLimit: () => ({ allowed: true }) }));
vi.mock("@/lib/jevThreadRerank", () => ({ scheduleJevThreadRerankShadow: vi.fn() }));
vi.mock("@/lib/providers", () => ({
  NoProvidersError: class extends Error {}, sanitizeProviderError: () => "context-check", visionChain: () => [],
  withFallback: async (run: (tier: object) => Promise<unknown>) => ({ value: await run({ name: "cerebras", model: "offline", providerOptions: {} }), via: "offline" }),
}));
import { POST } from "@/app/api/sort/route";

it("carries whole-capture meaning into both classification stages and preserves a supplied coherent thought", async () => {
  vi.stubEnv("CAPTURE_CLOUD", undefined);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No network in this check"); }));
  const raw = "Learning to sell the recording tool would help with later projects I've built. I will build.";
  const recovery = { clean: raw, kind: "thread", title: "Learning from sales", actions: [], primaryActions: [], shelfLife: "keep", due: null, threadId: "recording", threadName: null, primaryText: raw, also: [] };
  const plan = { items: [{ id: "thought", source: raw, kind: "developing_thought", action: null, due: null, ownerId: null, destinations: [{ type: "existing", threadId: "recording" }], duplicateActionId: null, unresolved: false, ambiguity: null }], newThreads: [] };
  // Supplied model outputs check the pipeline, not live semantic accuracy.
  ai.generateObject.mockResolvedValueOnce({ object: recovery }).mockResolvedValueOnce({ object: plan }).mockResolvedValueOnce({ object: { decisions: [{ itemId: "thought", mode: "indivisible", destinations: [{ type: "existing", threadId: "recording" }] }] } });
  try {
    const response = await POST(new Request("http://localhost/api/sort", { method: "POST", body: JSON.stringify({ captureId: "context", routingPlanVersion: 1, raw, threads: [{ id: "recording", name: "Recording tool", about: "Product development and sales" }], actions: [] }) }));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.routingPlan.items).toHaveLength(1);
    expect(result.routingPlan.items[0]).toMatchObject({ kind: "developing_thought", source: raw });
    expect(result.actions).toEqual([]);
    for (const [call] of ai.generateObject.mock.calls.slice(0, 2))
      expect(call.prompt).toContain("A sentence fragment may complete or repair the preceding thought");
  } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
});
