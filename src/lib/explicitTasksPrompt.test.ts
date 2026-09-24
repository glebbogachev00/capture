import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { explicitTasks, explicitTasksRaw } from "./explicitTasks.fixture";

const model = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock("ai", () => ({ generateObject: model.generate }));
vi.mock("@/lib/routing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./routing")>();
  return {
    ...actual,
    // This suite verifies prompt/task preservation, not the exact production
    // provider allowlist, which is covered by routing.test.ts.
    supportsSemanticSort: () => true,
  };
});
vi.mock("@/lib/providers", () => ({
  NoProvidersError: class extends Error {},
  sanitizeProviderError: () => "synthetic failure",
  withFallback: async (run: (tier: { model: object; name: string; modelId: string }) => Promise<unknown>) => ({
    value: await run({ model: {}, name: "gemini", modelId: "gemini-3.6-flash" }),
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

function withSourceSegments(value: typeof sortInterpretation) {
  const semantic = [
    ...value.thinking.map((share, ownerIndex) => ({ text: share.text, role: "thinking" as const, ownerIndex })),
    ...value.actions.map((action, ownerIndex) => ({ text: action.sourceText, role: "action" as const, ownerIndex })),
  ].map((segment) => ({ ...segment, start: value.clean.indexOf(segment.text) }))
    .sort((left, right) => left.start - right.start);
  const sourceSegments: {
    text: string;
    role: "thinking" | "action" | "context";
    ownerIndex: number | null;
    actionOwnerIndexes: number[] | null;
  }[] = [];
  let cursor = 0;
  for (const segment of semantic) {
    const gap = value.clean.slice(cursor, segment.start);
    if (gap) sourceSegments.push({ text: gap, role: "context", ownerIndex: null, actionOwnerIndexes: null });
    sourceSegments.push({ text: segment.text, role: segment.role, ownerIndex: segment.ownerIndex, actionOwnerIndexes: null });
    cursor = segment.start + segment.text.length;
  }
  const tail = value.clean.slice(cursor);
  if (tail) sourceSegments.push({ text: tail, role: "context", ownerIndex: null, actionOwnerIndexes: null });
  let thinkingIndex = 0;
  let actionIndex = 0;
  return {
    title: value.title,
    segments: sourceSegments.map((segment) => {
      if (segment.role === "context") {
        return {
          role: "context" as const,
          source: segment.text,
          threadId: null,
          threadName: null,
          ownsImage: null,
          action: null,
          thinkingOrdinal: null,
          intention: null,
          actionOrdinals: null,
          shelfLife: null,
          due: null,
        };
      }
      if (segment.role === "thinking") {
        const share = value.thinking[thinkingIndex];
        thinkingIndex += 1;
        return {
          role: "thinking" as const,
          source: segment.text,
          threadId: share.threadId,
          threadName: share.threadName,
          ownsImage: false,
          action: null,
          thinkingOrdinal: null,
          intention: null,
          actionOrdinals: null,
          shelfLife: null,
          due: null,
        };
      }
      const action = value.actions[actionIndex];
      actionIndex += 1;
      return {
        role: "action" as const,
        source: segment.text,
        threadId: null,
        threadName: null,
        ownsImage: null,
        action: action.text,
        thinkingOrdinal: action.thinkingIndex === null ? null : action.thinkingIndex + 1,
        intention: null,
        actionOrdinals: null,
        shelfLife: action.shelfLife,
        due: action.due,
      };
    }),
  };
}

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
      return { object: schema.parse(withSourceSegments(value)) };
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