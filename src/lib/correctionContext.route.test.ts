import { beforeEach, describe, expect, it, vi } from "vitest";

const ai = vi.hoisted(() => ({ generateObject: vi.fn(), generateText: vi.fn() }));
vi.mock("ai", () => ai);
vi.mock("@/lib/clientIp", () => ({ clientIp: () => "synthetic" }));
vi.mock("@/lib/limiter", () => ({ modelRateLimit: () => ({ allowed: true }) }));
vi.mock("@/lib/providers", () => ({
  NoProvidersError: class extends Error {},
  sanitizeProviderError: () => "synthetic failure",
  visionChain: () => [],
  withFallback: async (call: (tier: object) => Promise<unknown>) => ({
    value: await call({ model: "mock-model" }),
    via: "mock-model",
    preferred: "mock-model",
    fallback: false,
  }),
}));

import { POST } from "@/app/api/sort/route";

const threads = [
  { id: "capture", name: "Capture", about: "Capture product decisions" },
  { id: "errands", name: "Errands", about: "Things to do later" },
];

const sorted = (over: Record<string, unknown> = {}) => ({
  clean: "Ship the quick follow-up later.",
  kind: "thread",
  title: "Quick follow-up",
  actions: [],
  primaryActions: [],
  primaryText: null,
  shelfLife: "keep",
  due: null,
  threadId: "errands",
  threadName: null,
  also: [],
  ...over,
});

async function post(body: Record<string, unknown>) {
  return POST(new Request("http://localhost/api/sort", {
    method: "POST",
    body: JSON.stringify({ raw: "Ship the quick follow-up later.", threads, ...body }),
  }));
}

beforeEach(() => {
  ai.generateObject.mockReset();
});

describe("routing correction context", () => {
  it("never executes a legacy phrase rule over the model's routing decision", async () => {
    ai.generateObject.mockResolvedValue({ object: sorted() });

    const response = await post({
      rules: ['Captures about "quick later" belong in "Capture"'],
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ kind: "thread", threadId: "errands" });
  });

  it("gives unseen paraphrases to the model as bounded semantic examples", async () => {
    ai.generateObject.mockImplementation(async ({ prompt }: { prompt: string }) => {
      expect(prompt).toContain("The person corrected these earlier captures");
      expect(prompt).toContain("Need to tighten the handoff so Capture can ship sooner.");
      expect(prompt).toContain('threadId "capture"');
      return { object: sorted({ clean: "Get the release handoff moving without delay.", threadId: "capture" }) };
    });

    const response = await post({
      raw: "Get the release handoff moving without delay.",
      correctionExamples: [{
        capture: "Need to tighten the handoff so Capture can ship sooner.",
        kind: "thread",
        threadId: "capture",
        threadName: "Capture",
      }],
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ threadId: "capture" });
  });

  it("cannot redirect unrelated overlap unless the model chooses that destination", async () => {
    ai.generateObject.mockResolvedValue({ object: sorted({ threadId: "errands" }) });

    const response = await post({
      correctionExamples: [{
        capture: "Make Capture feel fast later when the board is crowded.",
        kind: "thread",
        threadId: "capture",
        threadName: "Capture",
      }],
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ threadId: "errands" });
  });
});
