import { afterEach, expect, it, vi } from "vitest";
const ai = vi.hoisted(() => ({ generateObject: vi.fn(), generateText: vi.fn() }));
vi.mock("ai", () => ai);
vi.mock("@/lib/clientIp", () => ({ clientIp: () => "offline-check" }));
vi.mock("@/lib/limiter", () => ({ modelRateLimit: () => ({ allowed: true }) }));
vi.mock("@/lib/jevThreadRerank", () => ({ scheduleJevThreadRerankShadow: vi.fn() }));
vi.mock("@/lib/providers", () => ({
  NoProvidersError: class extends Error {},
  sanitizeProviderError: () => "offline-check",
  visionChain: () => [],
  withFallback: async (run: (tier: object) => Promise<unknown>) => ({ value: await run({ name: "cerebras", model: "offline", providerOptions: {} }), via: "offline" }),
}));
import { POST } from "@/app/api/sort/route";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); ai.generateObject.mockReset(); });

it.each([
  { raw: "Add this to Rest day planning: on a rest day I want to walk, play a game, and avoid turning recovery into another productivity target.", kind: "developing_thought", target: "rest", action: null },
  { raw: 'The article quotes "Add this to Rest day planning" as an example of unclear wording.', kind: "developing_thought", target: "writing", action: null },
  { raw: "Remind me to file the receipt in Rest day planning later.", kind: "action", target: null, action: "File the receipt in Rest day planning" },
])("carries filing intent guidance through both existing stages: $raw", async ({ raw, kind, target, action }) => {
  vi.stubEnv("CAPTURE_CLOUD", undefined);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No network in this check"); }));
  const threads = [{ id: "rest", name: "Rest day planning", about: "Rest days" }, { id: "writing", name: "Writing", about: "Writing notes" }];
  const recovery = { clean: raw, kind: action ? "action" : "thread", title: "Note", actions: action ? [action] : [], primaryActions: [], shelfLife: "keep", due: null, threadId: target, threadName: null, primaryText: null, also: [] };
  const plan = { items: [{ id: "one", source: raw, kind, action, due: null, ownerId: null, duplicateActionId: null, unresolved: false, ambiguity: null, destinations: target ? [{ type: "existing", threadId: target }] : [] }], newThreads: [] };
  // Supplied interpretations verify wiring only, not model understanding.
  ai.generateObject.mockResolvedValueOnce({ object: recovery }).mockResolvedValueOnce({ object: plan });
  if (target) ai.generateObject.mockResolvedValueOnce({ object: { decisions: [{ itemId: "one", mode: "indivisible", destinations: [{ type: "existing", threadId: target }] }] } });
  const response = await POST(new Request("http://localhost/api/sort", { method: "POST", body: JSON.stringify({ raw, threads, actions: [], routingPlanVersion: 1, captureId: "filing-check" }) }));
  expect(response.status).toBe(200);
  const result = await response.json();
  expect(result.routingPlan.items[0].kind).toBe(kind);
  expect(result.routingPlan.items[0].source).toBe(raw);
  expect(result.actions).toEqual(action ? [action] : []);
  expect(ai.generateObject).toHaveBeenCalledTimes(target ? 3 : 2);
  for (const [call] of ai.generateObject.mock.calls.slice(0, 2)) {
    expect(call.prompt).toContain("Present filing requests to Capture");
    expect(call.prompt).toContain("Do not make the filing instruction an Action");
    expect(call.prompt).toContain("Quoted instructions, hypothetical examples, and reminders to file later");
  }
});
