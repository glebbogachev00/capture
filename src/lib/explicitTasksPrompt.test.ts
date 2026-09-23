import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { explicitTasks, explicitTasksRaw } from "./explicitTasks.fixture";

const model = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock("ai", () => ({ generateObject: model.generate }));
vi.mock("@/lib/providers", () => ({
  NoProvidersError: class extends Error {},
  sanitizeProviderError: () => "synthetic failure",
  withFallback: async (run: (tier: { model: object }) => Promise<unknown>) => ({
    value: await run({ model: {} }),
    via: "mock-fallback",
    preferred: "mock-primary",
    fallback: true,
    fallbackReason: "rate_limit",
  }),
}));

import { POST as sort } from "@/app/api/sort/route";
import { POST as distill } from "@/app/api/distill/route";

const sortInterpretation = {
  clean: explicitTasksRaw,
  title: "App launch tasks",
  thinking: [{
    text: "While I am in there, I keep thinking about a later product idea: a tiny release assistant that turns a pull request into a clear customer update.",
    threadId: null,
    threadName: "Release assistant",
  }],
  actions: [
    { text: explicitTasks[0], sourceText: "I need to fix the signup error that only appears after an invite is accepted,", thinkingIndex: null, shelfLife: "keep", due: null },
    { text: explicitTasks[1], sourceText: "and test the pricing experiment comparing usage-based billing with seats.", thinkingIndex: null, shelfLife: "weeks", due: null },
    { text: explicitTasks[2], sourceText: "The build is getting slow after the new analytics package, so I should profile the render path before we add another dashboard.", thinkingIndex: null, shelfLife: "weeks", due: null },
    { text: explicitTasks[3], sourceText: "I also need to document onboarding so a new developer can run the app without asking me where the environment variables come from.", thinkingIndex: null, shelfLife: "weeks", due: null },
  ],
  intention: null,
  shelfLife: "keep",
  due: null,
};

const settled = {
  clean: explicitTasksRaw,
  kind: "action",
  title: "App launch tasks",
  actions: explicitTasks,
  shelfLife: "keep",
  threadId: null,
  threadName: null,
  due: null,
};

const request = (body: object) => new Request("http://capture.test/api/sort", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ localDate: "2026-09-23", timeZone: "UTC", ...body }),
});

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(() => {
    throw new Error("No network in prompt regression tests");
  }));
  model.generate.mockReset();
});

afterEach(() => vi.unstubAllGlobals());

describe("explicit task count in the actual model prompts", () => {
  it.each([undefined, "action"] as const)("sort force=%s preserves every explicit commitment", async (force) => {
    model.generate.mockImplementation(async ({ schema }) => {
      const value = force === "action"
        ? {
            ...sortInterpretation,
            thinking: [],
            actions: sortInterpretation.actions.map((action, index) => index === sortInterpretation.actions.length - 1
              ? { ...action, sourceText: `${action.sourceText} ${sortInterpretation.thinking[0].text}` }
              : action),
          }
        : sortInterpretation;
      return { object: schema.parse(value) };
    });
    const res = await sort(request({ raw: explicitTasksRaw, threads: [], force }));

    expect(res.status).toBe(200);
    const { prompt } = model.generate.mock.calls[0][0];
    expect(prompt).toContain(explicitTasksRaw);
    expect(prompt).toMatch(/Return every explicit commitment once/i);
    expect(prompt).toMatch(/Do not turn .* advice into tasks/i);
    expect(prompt).not.toMatch(/(?:1\s*[-–]\s*3|one to three)\s+(?:imperative\s+one-line\s+)?items/i);
    const body = await res.json();
    expect(body.actions).toEqual(explicitTasks);
    expect(body.routing).toEqual({
      preferred: "mock-primary",
      fallback: true,
      fallbackReason: "rate_limit",
    });
  });

  it("Distill settlement still preserves every distinct agreed task", async () => {
    model.generate.mockImplementation(async ({ schema }) => ({
      object: schema.parse(settled),
    }));
    const res = await distill(request({
      op: "settle",
      turns: [{ role: "user", text: explicitTasksRaw }],
      threads: [],
    }));

    expect(res.status).toBe(200);
    const { system, prompt } = model.generate.mock.calls[0][0];
    expect(prompt).toContain(explicitTasksRaw);
    expect(system).not.toMatch(/one to three imperative items/i);
    expect(system).toMatch(/every distinct.*(?:task|item)/i);
    expect(system).toMatch(/never invent a task/i);
    expect((await res.json()).actions).toEqual(explicitTasks);
  });
});