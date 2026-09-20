import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { explicitTasks, explicitTasksRaw } from "./explicitTasks.fixture";

const model = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock("ai", () => ({ generateObject: model.generate }));
vi.mock("@/lib/providers", () => ({
  NoProvidersError: class extends Error {},
  sanitizeProviderError: () => "synthetic failure",
  withFallback: async (run: (tier: { model: object }) => Promise<unknown>) => ({
    value: await run({ model: {} }), via: "mock-provider",
  }),
}));

import { POST as sort } from "@/app/api/sort/route";
import { POST as distill } from "@/app/api/distill/route";

const response = {
  clean: explicitTasksRaw, kind: "action", title: "App launch tasks",
  actions: explicitTasks, primaryActions: [], shelfLife: "keep", due: null,
  threadId: null, threadName: null, primaryText: null, also: null,
};
const request = (body: object) => new Request("http://capture.test/api/sort", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No network in prompt regression tests"); }));
  model.generate.mockReset();
  // Only the provider is mocked: the actual route builds the prompt and schema.
  model.generate.mockImplementation(async ({ schema }) => ({ object: schema.parse(response) }));
});

afterEach(() => vi.unstubAllGlobals());

describe("explicit task count in the actual model prompts", () => {
  it.each([undefined, "action"] as const)("sort force=%s requests every distinct task without a numeric cap", async (force) => {
    const res = await sort(request({ raw: explicitTasksRaw, threads: [], force }));
    expect(res.status).toBe(200);
    const { prompt } = model.generate.mock.calls[0][0];
    expect(prompt).toContain(explicitTasksRaw);
    expect(prompt).not.toMatch(/(?:1\s*[-–]\s*3|one to three)\s+(?:imperative\s+one-line\s+)?items/i);
    expect(prompt).toMatch(/every distinct.*(?:task|item)/i);
    expect(prompt).toMatch(/(?:never invent|not invent)/i);
    expect(prompt).toMatch(/(?:clauses|clause)/i);
    expect(prompt).toMatch(/(?:return one|one action|one item)/i);
    expect((await res.json()).actions).toEqual(explicitTasks);
  });

  it("Distill settlement requests every distinct agreed task, not one to three", async () => {
    const res = await distill(request({ op: "settle", turns: [{ role: "user", text: explicitTasksRaw }], threads: [] }));
    expect(res.status).toBe(200);
    const { system, prompt } = model.generate.mock.calls[0][0];
    expect(prompt).toContain(explicitTasksRaw);
    expect(system).not.toMatch(/one to three imperative items/i);
    expect(system).toMatch(/every distinct.*(?:task|item)/i);
    expect(system).toMatch(/never invent a task/i);
    expect(system).toMatch(/(?:clauses|clause)/i);
    expect((await res.json()).actions).toEqual(explicitTasks);
  });
});
