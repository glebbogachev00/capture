import { Buffer } from "node:buffer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_SORT_IMAGE_BYTES } from "./sortImageDataUrl";

const ai = vi.hoisted(() => ({ generateObject: vi.fn(), generateText: vi.fn() }));
const jev = vi.hoisted(() => ({ scheduleJevThreadRerankShadow: vi.fn() }));
const providers = vi.hoisted(() => ({
  visionEnabled: true,
  providerName: "groq",
  fallbackProviderName: null as string | null,
}));
vi.mock("ai", () => ai);
vi.mock("@/lib/clientIp", () => ({ clientIp: () => "synthetic" }));
vi.mock("@/lib/limiter", () => ({ modelRateLimit: () => ({ allowed: true }) }));
vi.mock("@/lib/jevThreadRerank", () => jev);
vi.mock("@/lib/providers", () => ({
  NoProvidersError: class extends Error {},
  sanitizeProviderError: () => "synthetic failure",
  visionChain: () => providers.visionEnabled ? [{}] : [],
  withFallback: async (call: (tier: object) => Promise<unknown>) => {
    const names = [providers.providerName, providers.fallbackProviderName].filter(Boolean) as string[];
    let lastError: unknown;
    for (const name of names) {
      try {
        return {
          value: await call({
            name,
            model: "mock-model",
            providerOptions: name === "cerebras"
              ? { cerebras: { reasoningEffort: "low", reasoningFormat: "hidden" } }
              : {},
          }),
          via: name,
          preferred: providers.providerName,
          fallback: name !== providers.providerName,
          fallbackReason: name !== providers.providerName ? "provider_failure" : null,
        };
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  },
}));

import { POST } from "@/app/api/sort/route";

const raw = "Capture needs a quiet explanation. Retake playback stalls. Draft labels tomorrow.";
const threads = [
  { id: "capture", name: "Capture filing", about: "Capture filing and retrieval." },
  { id: "retake", name: "Retake workflow", about: "Retake playback and editing." },
];
const actions = [{ id: "existing", text: "Send the synthetic review email" }];
const png = (marker = 0) => `data:image/png;base64,${Buffer.from([
  137, 80, 78, 71, 13, 10, 26, 10, marker,
]).toString("base64")}`;
const jpeg = `data:image/jpeg;base64,${Buffer.from([255, 216, 255, 224, 0]).toString("base64")}`;
const recovery = {
  clean: raw,
  kind: "both",
  title: "Filing and playback",
  actions: ["Draft labels tomorrow"],
  primaryActions: [],
  shelfLife: "keep",
  due: "2026-09-30",
  threadId: "capture",
  threadName: null,
  primaryText: "Capture needs a quiet explanation.",
  also: [{ text: "Retake playback stalls.", threadId: "retake", threadName: null }],
};
const validPlan = {
  items: [
    {
      id: "capture-thought",
      source: "Capture needs a quiet explanation. ",
      kind: "developing_thought",
      action: null,
      due: null,
      ownerId: null,
      destinations: [{ type: "existing", threadId: "capture" }],
      duplicateActionId: null,
      unresolved: false,
      ambiguity: null,
    },
    {
      id: "retake-thought",
      source: "Retake playback stalls. ",
      kind: "developing_thought",
      action: null,
      due: null,
      ownerId: null,
      destinations: [{ type: "existing", threadId: "retake" }],
      duplicateActionId: null,
      unresolved: false,
      ambiguity: null,
    },
    {
      id: "draft-action",
      source: "Draft labels",
      kind: "action",
      action: "Draft labels tomorrow",
      due: null,
      ownerId: null,
      destinations: [],
      duplicateActionId: null,
      unresolved: false,
      ambiguity: null,
    },
    {
      id: "draft-due",
      source: " tomorrow.",
      kind: "deadline",
      action: null,
      due: "2026-09-30",
      ownerId: "draft-action",
      destinations: [],
      duplicateActionId: null,
      unresolved: false,
      ambiguity: null,
    },
  ],
  newThreads: [],
};

const ownershipFromPrompt = async ({ schema, prompt }: { schema?: { parse: (value: unknown) => unknown }; prompt: string }) => {
  const deadlinePrefix = "Deadline items (stable id, exact immutable source phrase, immutable owner Action id):\n";
  const deadlineStart = prompt.indexOf(deadlinePrefix);
  if (deadlineStart >= 0) {
    const jsonStart = deadlineStart + deadlinePrefix.length;
    const jsonEnd = prompt.indexOf("\n\nReturn exactly one decision", jsonStart);
    const candidates = JSON.parse(prompt.slice(jsonStart, jsonEnd)) as Array<{
      id: string;
      source: string;
      ownerActionId: string;
    }>;
    const todayMatch = /Current local calendar date: (\d{4}-\d{2}-\d{2})/.exec(prompt);
    if (!todayMatch) throw new Error("missing deadline calendar authority");
    const today = new Date(`${todayMatch[1]}T12:00:00Z`);
    const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    const isoAfter = (days: number) => {
      const shifted = new Date(today);
      shifted.setUTCDate(shifted.getUTCDate() + days);
      return shifted.toISOString().slice(0, 10);
    };
    const decisions = candidates.map((candidate) => {
      const source = candidate.source.toLowerCase();
      if (source.includes("tomorrow")) {
        return {
          deadlineItemId: candidate.id,
          ownerActionId: candidate.ownerActionId,
          due: isoAfter(1),
          calendarOperation: { type: "day_offset", days: 1 },
        };
      }
      const namedWeekday = weekdays.find((weekday) => source.includes(weekday));
      if (namedWeekday) {
        const target = weekdays.indexOf(namedWeekday);
        const offset = (target - today.getUTCDay() + 7) % 7 || 7;
        return {
          deadlineItemId: candidate.id,
          ownerActionId: candidate.ownerActionId,
          due: isoAfter(offset),
          calendarOperation: {
            type: "next_weekday",
            weekday: namedWeekday,
            occurrence: "strictly_after_today",
          },
        };
      }
      const fixed = /\d{4}-\d{2}-\d{2}/.exec(candidate.source)?.[0];
      if (!fixed) throw new Error("unexpected synthetic deadline phrase");
      return {
        deadlineItemId: candidate.id,
        ownerActionId: candidate.ownerActionId,
        due: fixed,
        calendarOperation: { type: "fixed", iso: fixed },
      };
    });
    const object = { decisions };
    return { object: schema ? schema.parse(object) : object };
  }

  const actionPrefix = "Proposed Actions (id, wording, exact provenance source):\n";
  const actionStart = prompt.indexOf(actionPrefix);
  if (actionStart >= 0) {
    const jsonStart = actionStart + actionPrefix.length;
    const jsonEnd = prompt.indexOf("\n\nExisting open Actions", jsonStart);
    const proposed = JSON.parse(prompt.slice(jsonStart, jsonEnd)) as Array<{ id: string }>;
    const existingPrefix = "Existing open Actions (id and wording):\n";
    const existingStart = prompt.indexOf(existingPrefix);
    const existingJsonStart = existingStart + existingPrefix.length;
    const existingJsonEnd = prompt.indexOf("\n\nFor each proposed Action", existingJsonStart);
    const existing = JSON.parse(prompt.slice(existingJsonStart, existingJsonEnd)) as Array<{ id: string }>;
    const object = {
      decisions: proposed.map((candidate) => ({
        proposedActionId: candidate.id,
        outcome: "new",
        closestExistingActionId: existing[0].id,
        relation: "distinct_outcome",
        rationale: "The proposed Action leaves a separate result to complete.",
      })),
    };
    return { object: schema ? schema.parse(object) : object };
  }

  const combinedPrefix = "Developing-thought candidates (stable id, exact immutable source, current untrusted destinations):\n";
  const combinedStart = prompt.indexOf(combinedPrefix);
  if (combinedStart >= 0) {
    const readBlock = <T,>(prefix: string, suffix: string): T => {
      const start = prompt.indexOf(prefix);
      if (start < 0) throw new Error("unexpected combined semantic prompt");
      const jsonStart = start + prefix.length;
      const jsonEnd = prompt.indexOf(suffix, jsonStart);
      return JSON.parse(prompt.slice(jsonStart, jsonEnd)) as T;
    };
    const candidates = readBlock<Array<{
      itemId: string;
      source: string;
      currentDestinations: unknown[];
    }>>(combinedPrefix, "\n\nAvailable existing Threads");
    const proposed = readBlock<Array<{ id: string }>>(
      "Proposed Actions (stable id, wording, exact provenance source):\n",
      "\n\nExisting open Actions",
    );
    const existingActions = readBlock<Array<{ id: string }>>(
      "Existing open Actions (stable id and wording):\n",
      "\n\nDESTINATION DECISIONS",
    );
    const object = {
      destinationDecisions: candidates.map((candidate) => ({
        itemId: candidate.itemId,
        mode: "indivisible",
        destinations: candidate.currentDestinations,
      })),
      actionDecisions: existingActions.length ? proposed.map((candidate) => ({
        proposedActionId: candidate.id,
        outcome: "new",
        closestExistingActionId: existingActions[0].id,
        relation: "distinct_outcome",
        rationale: "The proposed Action leaves a separate result to complete.",
      })) : [],
    };
    return { object: schema ? schema.parse(object) : object };
  }

  const prefix = "Developing-thought items (stable id, immutable exact source, Unicode code-point length, current untrusted destinations):\n";
  const start = prompt.indexOf(prefix);
  if (start < 0) throw new Error("unexpected unmocked model call");
  const jsonStart = start + prefix.length;
  const jsonEnd = prompt.indexOf("\n\nIndexed immutable source ledgers", jsonStart);
  const candidates = JSON.parse(prompt.slice(jsonStart, jsonEnd)) as Array<{
    itemId: string;
    source: string;
    currentDestinations: unknown[];
  }>;
  const object = {
    decisions: candidates.map((candidate) => ({
      itemId: candidate.itemId,
      mode: "indivisible",
      destinations: candidate.currentDestinations,
    })),
  };
  return { object: schema ? schema.parse(object) : object };
};

const semanticFromPrompt = (
  overrides: Partial<{
    destinationDecisions: unknown[];
    actionDecisions: unknown[];
  }> = {},
) => async ({ schema, prompt, ...options }: {
  schema?: { parse: (value: unknown) => unknown };
  prompt: string;
  [key: string]: unknown;
}) => {
  const generated = await ownershipFromPrompt({ prompt });
  const base = generated.object as { decisions?: unknown[] };
  const decisions = prompt.includes("ACTION IDENTITY ADJUDICATION")
    ? overrides.actionDecisions ?? base.decisions
    : prompt.includes("DESTINATION AND SUBJECT-BOUNDARY ADJUDICATION")
      ? overrides.destinationDecisions ?? base.decisions
      : base.decisions;
  const object = { decisions };
  return { object: schema ? schema.parse(object) : object, options };
};

const request = (over: Record<string, unknown> = {}) =>
  new Request("http://localhost/api/sort", {
    method: "POST",
    body: JSON.stringify({
      captureId: "capture-one",
      raw,
      threads,
      routingPlanVersion: 1,
      actions: [],
      correctionExamples: [
        {
          capture: "Make the filing handoff quieter.",
          kind: "thread",
          threadId: "capture",
          threadName: "Capture filing",
        },
      ],
      ...over,
    }),
  });

afterEach(() => vi.useRealTimers());

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-29T12:00:00+07:00"));
  ai.generateObject.mockReset();
  ai.generateObject.mockImplementation(ownershipFromPrompt);
  ai.generateText.mockReset();
  jev.scheduleJevThreadRerankShadow.mockReset();
  providers.visionEnabled = true;
  providers.providerName = "groq";
  providers.fallbackProviderName = null;
});

describe("planned and validated sort route", () => {
  it.each(["action", "thread", "intention"] as const)(
    "rejects planner override of explicit %s command",
    async (force) => {
      const raw = "Preserve the explicit user destination";
      const candidate = {
        items: [{ ...validPlan.items[0], source: raw,
          kind: force === "action" ? "intention" : "action",
          action: force === "action" ? null : raw, destinations: [],
        }], newThreads: [],
      };
      ai.generateObject.mockResolvedValueOnce({ object: { ...recovery, clean: raw, due: null } });
      ai.generateObject.mockImplementation(async () => ({ object: candidate }));
      const response = await POST(request({ raw, force, actions: [] }));
      expect(response.status).toBe(502);
      expect(await response.json()).not.toHaveProperty("routingPlan");
      const plannerCalls = ai.generateObject.mock.calls.slice(1);
      expect(plannerCalls).toHaveLength(2);
      expect(plannerCalls[0][0].prompt).toContain(`Explicit user destination command: ${force}`);
      expect(plannerCalls[1][0].prompt).toContain("COMMAND_KIND_CONFLICT");
    },
  );


  it("requires an immutable capture identity before the first planned model call", async () => {
    const response = await POST(request({ captureId: undefined }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "bad request" });
    expect(ai.generateObject).not.toHaveBeenCalled();
  });

  it("rejects image planning and oversized Thread inventories before any model call", async () => {
    const image = await POST(request({ imgs: [png()] }));
    expect(image.status).toBe(400);

    const tooManyThreads = Array.from({ length: 61 }, (_, index) => ({
      id: `thread-${index}`,
      name: `Synthetic Thread ${index}`,
      about: `Synthetic boundary ${index}`,
    }));
    const inventory = await POST(request({ threads: tooManyThreads }));
    expect(inventory.status).toBe(400);
    const oversizedSource = await POST(request({ raw: "x".repeat(20_001) }));
    expect(oversizedSource.status).toBe(400);
    expect(ai.generateObject).not.toHaveBeenCalled();
  });

  it.each([2, 4])("interprets all %i images independently before ordinary sorting", async (count) => {
    const imgs = Array.from({ length: count }, (_, index) => png(index + 1));
    ai.generateText.mockImplementation(async ({ messages }) => {
      const image = messages[0].content.find((part: { type: string }) => part.type === "image").image;
      const index = imgs.indexOf(image);
      return { text: `Independent image ${index + 1}` };
    });
    ai.generateObject.mockImplementationOnce(async ({ schema, prompt }) => {
      for (let index = 0; index < count; index += 1) {
        expect(prompt).toContain(`Attached photo ${index + 1}: Independent image ${index + 1}`);
      }
      return { object: schema.parse(recovery) };
    });

    const response = await POST(request({
      routingPlanVersion: undefined,
      captureId: undefined,
      imgs,
    }));

    expect(response.status).toBe(200);
    expect(ai.generateText).toHaveBeenCalledTimes(count);
    expect(ai.generateText.mock.calls.map(([options]) =>
      options.messages[0].content.find((part: { type: string }) => part.type === "image").image
    )).toEqual(imgs);
    expect(ai.generateObject).toHaveBeenCalledTimes(1);
  });

  it("keeps the one-image interpretation contract unchanged", async () => {
    ai.generateText.mockResolvedValueOnce({ text: "One ordinary photo" });
    ai.generateObject.mockImplementationOnce(async ({ schema, prompt }) => {
      expect(prompt).toContain("(Attached photo: One ordinary photo)");
      expect(prompt).not.toContain("Attached photo 1:");
      return { object: schema.parse(recovery) };
    });

    const response = await POST(request({
      routingPlanVersion: undefined,
      captureId: undefined,
      imgs: [jpeg],
    }));

    expect(response.status).toBe(200);
    expect(ai.generateText).toHaveBeenCalledTimes(1);
    expect(ai.generateObject).toHaveBeenCalledTimes(1);
  });

  it("fails a one-image sort closed when vision is unavailable", async () => {
    providers.visionEnabled = false;

    const response = await POST(request({
      routingPlanVersion: undefined,
      captureId: undefined,
      imgs: [png()],
    }));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "The sort didn't go through." });
    expect(ai.generateText).not.toHaveBeenCalled();
    expect(ai.generateObject).not.toHaveBeenCalled();
  });

  it.each([
    ["null after provider failure", () => ai.generateText.mockRejectedValueOnce(new Error("vision failed"))],
    ["whitespace", () => ai.generateText.mockResolvedValueOnce({ text: "   \n  " })],
  ])("fails a one-image sort closed when its caption is %s", async (_case, arrange) => {
    arrange();

    const response = await POST(request({
      routingPlanVersion: undefined,
      captureId: undefined,
      imgs: [png()],
    }));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "The sort didn't go through." });
    expect(ai.generateText).toHaveBeenCalledTimes(1);
    expect(ai.generateObject).not.toHaveBeenCalled();
  });

  it.each([1, 2, 3, 4].flatMap((count) => [
    "No description available.",
    "No caption available!",
    "(image only).",
    "'No caption'",
    "*Description unavailable*",
    "No caption,",
    "No description available:",
    "Caption unavailable;",
    "Description unavailable—",
    "No caption available–",
    "Image only-",
    "**(\"No caption available,\")**",
  ].map((sentinel) => [count, sentinel] as const)))(
    "fails a %i-image sort closed when any normalized caption is the placeholder %j",
    async (count, sentinel) => {
      const imgs = Array.from({ length: count }, (_, index) => png(index + 1));
      ai.generateText.mockImplementation(async ({ messages }) => {
        const image = messages[0].content.find((part: { type: string }) => part.type === "image").image;
        const index = imgs.indexOf(image);
        return { text: index === count - 1 ? sentinel : `Independent image ${index + 1}` };
      });

      const response = await POST(request({
        routingPlanVersion: undefined,
        captureId: undefined,
        imgs,
      }));

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: "The sort didn't go through." });
      expect(ai.generateText).toHaveBeenCalledTimes(count);
      expect(ai.generateObject).not.toHaveBeenCalled();
    },
  );

  it.each([1, 2, 3, 4])(
    "preserves a near-neighbor caption containing sentinel words for a %i-image sort",
    async (count) => {
      const imgs = Array.from({ length: count }, (_, index) => png(index + 1));
      ai.generateText.mockImplementation(async ({ messages }) => {
        const image = messages[0].content.find((part: { type: string }) => part.type === "image").image;
        const index = imgs.indexOf(image);
        return { text: index === count - 1
          ? "A status card says **(\"No caption available,\")** beside a diagram"
          : `Independent image ${index + 1}` };
      });
      ai.generateObject.mockImplementationOnce(async ({ schema, prompt }) => {
        expect(prompt).toContain("A status card says **(\"No caption available,\")** beside a diagram");
        return { object: schema.parse(recovery) };
      });

      const response = await POST(request({
        routingPlanVersion: undefined,
        captureId: undefined,
        imgs,
      }));

      expect(response.status).toBe(200);
      expect(ai.generateText).toHaveBeenCalledTimes(count);
      expect(ai.generateObject).toHaveBeenCalledTimes(1);
    },
  );

  it("sorts an image-only capture only from a successful image interpretation", async () => {
    ai.generateText.mockResolvedValueOnce({ text: "A handwritten product decision" });
    ai.generateObject.mockImplementationOnce(async ({ schema, prompt }) => {
      expect(prompt).toContain('Raw capture:\n"""Photo: A handwritten product decision"""');
      return { object: schema.parse({ ...recovery, clean: "A handwritten product decision" }) };
    });

    const response = await POST(request({
      raw: "(image only)",
      routingPlanVersion: undefined,
      captureId: undefined,
      imgs: [png()],
    }));

    expect(response.status).toBe(200);
    expect(ai.generateText).toHaveBeenCalledTimes(1);
    expect(ai.generateObject).toHaveBeenCalledTimes(1);
  });

  it("fails a multi-image sort closed when no provider can interpret every image", async () => {
    providers.visionEnabled = false;

    const response = await POST(request({
      routingPlanVersion: undefined,
      captureId: undefined,
      imgs: [
        png(1),
        png(2),
      ],
    }));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "The sort didn't go through." });
    expect(ai.generateText).not.toHaveBeenCalled();
    expect(ai.generateObject).not.toHaveBeenCalled();
  });

  it.each([
    ["more than four images", Array.from({ length: 5 }, (_, index) => png(index))],
    ["a malformed image value", ["https://example.test/not-a-data-url.png"]],
    ["a non-image data URL", ["data:text/plain;base64,SGVsbG8="]],
    ["bad Base64 length", ["data:image/png;base64,AAA"]],
    ["bad Base64 padding", ["data:image/png;base64,AAAA==="]],
    ["bad Base64 characters", ["data:image/png;base64,AA*A"]],
    ["empty decoded bytes", ["data:image/png;base64,"]],
    ["non-image bytes under an image MIME", [
      `data:image/png;base64,${Buffer.from("plain text").toString("base64")}`,
    ]],
    ["a MIME/signature mismatch", [
      `data:image/png;base64,${Buffer.from([255, 216, 255, 224]).toString("base64")}`,
    ]],
    ["an oversized decoded image", [(() => {
      const bytes = Buffer.alloc(MAX_SORT_IMAGE_BYTES + 1);
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
      return `data:image/png;base64,${bytes.toString("base64")}`;
    })()]],
  ])("rejects %s before provider work", async (_case, imgs) => {
    const response = await POST(request({
      routingPlanVersion: undefined,
      captureId: undefined,
      imgs,
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "bad request" });
    expect(ai.generateText).not.toHaveBeenCalled();
    expect(ai.generateObject).not.toHaveBeenCalled();
  });

  it("leaves the protected recovery response unchanged unless the client opts in", async () => {
    ai.generateObject.mockImplementationOnce(async ({ schema }) => ({ object: schema.parse(recovery) }));

    const response = await POST(request({ routingPlanVersion: undefined, captureId: undefined }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject(recovery);
    expect(body.planned).toBeUndefined();
    expect(body.captureId).toBeUndefined();
    expect(ai.generateObject).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      label: "permission in learning",
      source: "I give myself permission to learn in public before I feel expert.",
      recoveryKind: "intention" as const,
      planKind: "intention" as const,
      threadId: null,
      actions: [],
    },
    {
      label: "chosen value at home",
      source: "I let hospitality shape the pace of our home.",
      recoveryKind: "intention" as const,
      planKind: "intention" as const,
      threadId: null,
      actions: [],
    },
    {
      label: "first-person inquiry",
      source: "I am trying to understand whether the river sensors drift after cold nights.",
      recoveryKind: "thread" as const,
      planKind: "developing_thought" as const,
      threadId: "river-sensors",
      actions: [],
    },
    {
      label: "explicit discrete commitment",
      source: "I commit to send the revised field guide to Mara.",
      recoveryKind: "action" as const,
      planKind: "action" as const,
      threadId: null,
      actions: ["Send the revised field guide to Mara"],
    },
  ])("carries the general Intention boundary through both real model stages: $label", async ({
    source,
    recoveryKind,
    planKind,
    threadId,
    actions: expectedActions,
  }) => {
    const routeThreads = [{
      id: "river-sensors",
      name: "River sensor observations",
      about: "Questions and observations about river sensor behavior.",
    }];
    const routeRecovery = {
      ...recovery,
      clean: source,
      kind: recoveryKind,
      actions: expectedActions,
      primaryActions: [],
      due: null,
      threadId,
      threadName: null,
      primaryText: null,
      also: [],
    };
    const routePlan = {
      items: [{
        id: "semantic-item",
        source,
        kind: planKind,
        action: planKind === "action" ? expectedActions[0] : null,
        due: null,
        ownerId: null,
        destinations: planKind === "developing_thought"
          ? [{ type: "existing" as const, threadId: "river-sensors" }]
          : [],
        duplicateActionId: null,
        unresolved: false,
        ambiguity: null,
      }],
      newThreads: [],
    };
    ai.generateObject
      .mockImplementationOnce(async ({ schema, prompt }) => {
        expect(prompt).toContain("Classify the speech act before the topic or the sentence's main verb");
        expect(prompt).toContain("For each semantic claim, first ask whether the source assigns a discrete completable act");
        expect(prompt).toContain("standing personal stance, permission, value, or way of living");
        expect(prompt).toContain("names no discrete act that can be completed once");
        expect(prompt).toContain("factual observation, belief under examination, uncertainty, or inquiry");
        expect(prompt).toContain("discrete promise, request, or commitment to perform a completable act");
        expect(prompt).toContain("An Intention owns no Action and no Thread destination");
        return { object: schema.parse(routeRecovery) };
      })
      .mockImplementationOnce(async ({ schema, prompt }) => {
        expect(prompt).toContain("Classify the speech act before the topic or the sentence's main verb");
        expect(prompt).toContain("For each semantic claim, first ask whether the source assigns a discrete completable act");
        expect(prompt).toContain("standing personal stance, permission, value, or way of living");
        expect(prompt).toContain("names no discrete act that can be completed once");
        expect(prompt).toContain("factual observation, belief under examination, uncertainty, or inquiry");
        expect(prompt).toContain("discrete promise, request, or commitment to perform a completable act");
        expect(prompt).toContain("An Intention owns no Action and no Thread destination");
        return { object: schema.parse(routePlan) };
      });

    const response = await POST(request({
      raw: source,
      threads: routeThreads,
      actions: [],
      correctionExamples: [],
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.routingPlan).toEqual(routePlan);
    expect(body.kind).toBe(recoveryKind);
    expect(body.threadId).toBe(threadId);
    expect(body.actions).toEqual(expectedActions);
    expect(ai.generateObject).toHaveBeenCalledTimes(planKind === "developing_thought" ? 3 : 2);
  });

  it("returns the validated raw plan with its recovery interpretation, not only a legacy preview", async () => {
    let plannerPrompt = "";
    ai.generateObject
      .mockImplementationOnce(async ({ schema }) => ({ object: schema.parse(recovery) }))
      .mockImplementationOnce(async ({ schema, prompt }) => {
        plannerPrompt = prompt;
        return { object: schema.parse(validPlan) };
      });

    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(plannerPrompt).toContain("PLANNED ROUTING STAGE");
    expect(plannerPrompt).toContain(JSON.stringify(threads));
    expect(plannerPrompt).toContain("Make the filing handoff quieter.");
    expect(plannerPrompt).toContain("Initial interpretation (advisory)");
    expect(plannerPrompt).toContain(`"kind":${JSON.stringify(recovery.kind)}`);
    expect(plannerPrompt).toContain(`"title":${JSON.stringify(recovery.title)}`);
    expect(plannerPrompt).toContain("Existing open Actions are intentionally withheld");
    expect(plannerPrompt).not.toContain("action strings are authoritative");
    expect(await response.json()).toMatchObject({
      captureId: "capture-one",
      planned: true,
      kind: "both",
      threadId: "capture",
      actions: ["Draft labels tomorrow"],
      actionDetails: [
        {
          text: "Draft labels tomorrow",
          due: "2026-09-30",
          source: "Draft labels tomorrow.",
        },
      ],
      also: [{ text: "Retake playback stalls.", threadId: "retake", threadName: null }],
      unresolved: [],
      routingPlan: validPlan,
      recovery,
    });
    expect(ai.generateObject).toHaveBeenCalledTimes(4);
    expect(jev.scheduleJevThreadRerankShadow).not.toHaveBeenCalled();
  });

  it("passes only bounded structured live correction evidence to planner and destination adjudication", async () => {
    const correctionExamples = [
      {
        key: "correction:first",
        text: "serialized phrase map must not cross the route boundary → Capture filing",
        capture: "A release handoff should make ownership obvious.",
        kind: "thread",
        threadId: "capture",
        threadName: "Capture filing",
        lastAt: 10,
      },
      {
        key: "correction:conflict",
        text: "another serialized phrase map → Retake workflow",
        capture: "A release handoff should make ownership obvious.",
        kind: "thread",
        threadId: "retake",
        threadName: "Retake workflow",
        lastAt: 9,
      },
      {
        capture: "This destination was deleted.",
        kind: "thread",
        threadId: "deleted-thread",
        threadName: "Deleted Thread",
      },
      {
        capture: "This Thread correction has no destination id.",
        kind: "thread",
        threadName: "Malformed",
      },
    ];
    ai.generateObject
      .mockImplementationOnce(async ({ schema }) => ({ object: schema.parse(recovery) }))
      .mockImplementationOnce(async ({ schema }) => ({ object: schema.parse(validPlan) }));

    const response = await POST(request({ correctionExamples }));
    expect(response.status).toBe(200);

    const prompts = ai.generateObject.mock.calls
      .map(([options]) => String(options.prompt ?? ""));
    const plannerPrompt = prompts.find((prompt) => prompt.includes("PLANNED ROUTING STAGE"));
    const destinationPrompt = prompts.find((prompt) =>
      prompt.includes("DESTINATION AND SUBJECT-BOUNDARY ADJUDICATION")
    );
    for (const semanticPrompt of [plannerPrompt, destinationPrompt]) {
      expect(semanticPrompt).toContain('"threadId":"capture"');
      expect(semanticPrompt).toContain('"threadId":"retake"');
      expect(semanticPrompt).not.toContain("deleted-thread");
      expect(semanticPrompt).not.toContain("This Thread correction has no destination id.");
      expect(semanticPrompt).not.toContain("serialized phrase map");
      expect(semanticPrompt).not.toContain('"key":"correction:');
      expect(semanticPrompt).not.toContain('"lastAt":');
    }
  });

  it("lets the destination model resolve conflicting correction examples without deterministic override", async () => {
    ai.generateObject.mockImplementation(semanticFromPrompt({
      destinationDecisions: [
        { itemId: "capture-thought", mode: "indivisible", destinations: [{ type: "existing", threadId: "retake" }] },
        { itemId: "retake-thought", mode: "indivisible", destinations: [{ type: "existing", threadId: "retake" }] },
      ],
    }))
      .mockImplementationOnce(async ({ schema }) => ({ object: schema.parse(recovery) }))
      .mockImplementationOnce(async ({ schema }) => ({ object: schema.parse(validPlan) }));

    const response = await POST(request({
      correctionExamples: [
        {
          capture: "A release handoff should make ownership obvious.",
          kind: "thread",
          threadId: "capture",
          threadName: "Capture filing",
        },
        {
          capture: "A release handoff should make ownership obvious.",
          kind: "thread",
          threadId: "retake",
          threadName: "Retake workflow",
        },
      ],
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.routingPlan.items[0].destinations).toEqual([
      { type: "existing", threadId: "retake" },
    ]);
  });

  it("references an existing Action when a cross-domain paraphrase has the same intended outcome", async () => {
    const source = "Check that the museum booking is confirmed.";
    const existingActions = [{
      id: "museum-reservation",
      text: "Confirm the venue reservation with the museum",
    }];
    const routeRecovery = {
      ...recovery,
      clean: source,
      kind: "action" as const,
      actions: ["Check that the museum booking is confirmed"],
      primaryActions: [],
      due: null,
      threadId: null,
      threadName: null,
      primaryText: null,
      also: [],
    };
    const routePlan = {
      items: [{
        id: "museum-check",
        source,
        kind: "action" as const,
        action: "Check that the museum booking is confirmed",
        due: null,
        ownerId: null,
        destinations: [],
        duplicateActionId: null,
        unresolved: false,
        ambiguity: null,
      }],
      newThreads: [],
    };
    ai.generateObject
      .mockImplementationOnce(async ({ schema }) => ({ object: schema.parse(routeRecovery) }))
      .mockImplementationOnce(async ({ schema, prompt }) => {
        expect(schema.shape.items.element.shape.duplicateActionId.description).toContain(
          "dedicated Action identity adjudicator"
        );
        expect(prompt).not.toContain("Compare the intended outcome and finish line, not the wording");
        return { object: schema.parse(routePlan) };
      })
      .mockImplementationOnce(async ({ schema, prompt }) => {
        expect(prompt).toContain("ACTION IDENTITY ADJUDICATION");
        expect(prompt).not.toContain("Developing-thought items");
        expect(prompt).not.toContain("destinationDecisions");
        expect(prompt).toContain("compare its intended outcome and finish line with all existing Actions");
        expect(prompt).toContain("closestExistingActionId");
        expect(prompt).toContain("concise remaining outcome or finish-line difference");
        return { object: schema.parse({
          decisions: [{
            proposedActionId: "museum-check",
            outcome: "existing",
            existingActionId: "museum-reservation",
            relation: "same_outcome",
            rationale: "Both Actions finish by confirming the museum reservation.",
          }],
        }) };
      });

    const response = await POST(request({
      raw: source,
      threads: [],
      actions: existingActions,
      correctionExamples: [],
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.actions).toEqual([]);
    expect(body.actionDetails).toEqual([]);
    expect(body.routingPlan).toEqual({
      ...routePlan,
      items: [{ ...routePlan.items[0], duplicateActionId: "museum-reservation" }],
    });
    expect(ai.generateObject).toHaveBeenCalledTimes(3);
  });

  it("reuses the exact P6 paraphrase through Cerebras json_object transport and local validation", async () => {
    providers.providerName = "cerebras";
    const source = "Look over the made-up lesson plan.";
    const routeRecovery = {
      ...recovery,
      clean: source,
      kind: "action" as const,
      actions: ["Look over the made-up lesson plan"],
      primaryActions: [],
      due: null,
      threadId: null,
      threadName: null,
      primaryText: null,
      also: [],
    };
    const routePlan = {
      items: [{
        id: "lesson-review",
        source,
        kind: "action" as const,
        action: "Look over the made-up lesson plan",
        due: null,
        ownerId: null,
        destinations: [],
        duplicateActionId: null,
        unresolved: false,
        ambiguity: null,
      }],
      newThreads: [],
    };

    ai.generateObject
      .mockImplementationOnce(async ({ schema }) => ({ object: schema.parse(routeRecovery) }))
      .mockImplementationOnce(async (options) => {
        expect(options.schema).toBeUndefined();
        expect(options.output).toBe("no-schema");
        expect(options.maxRetries).toBe(0);
        return { object: routePlan };
      })
      .mockImplementationOnce(async (options) => {
        expect(options.schema).toBeUndefined();
        expect(options.output).toBe("no-schema");
        expect(options.maxRetries).toBe(0);
        expect(options.prompt).toContain('"id":"seed-action-1"');
        return { object: {
          decisions: [{
            proposedActionId: "lesson-review",
            outcome: "existing",
            existingActionId: "seed-action-1",
            relation: "same_outcome",
            rationale: "Both Actions finish by reviewing the same fictional lesson plan.",
          }],
        } };
      });

    const response = await POST(request({
      raw: source,
      threads: [],
      actions: [{ id: "seed-action-1", text: "Review the synthetic lesson outline" }],
      correctionExamples: [],
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.actions).toEqual([]);
    expect(body.actionDetails).toEqual([]);
    expect(body.routingPlan.items[0]).toEqual({
      ...routePlan.items[0],
      duplicateActionId: "seed-action-1",
    });
    expect(ai.generateObject).toHaveBeenCalledTimes(3);
  });

  it("keeps mixed thought routing and duplicate Action identity stable across accumulated context", async () => {
    const source =
      "The museum queue notes need a clearer distinction between timed entry and walk-up access. Check that the museum booking is confirmed.";
    const routeThreads = [{
      id: "museum-visit",
      name: "Museum visit notes",
      about: "Developing observations about museum access and visitor flow.",
    }];
    const existingActions = [{
      id: "museum-reservation",
      text: "Confirm the venue reservation with the museum",
    }];
    const accumulatedActions = [
      ...existingActions,
      { id: "unrelated-follow-up", text: "Send the orchard map to the irrigation installer" },
    ];
    const thoughtSource =
      "The museum queue notes need a clearer distinction between timed entry and walk-up access. ";
    const actionSource = "Check that the museum booking is confirmed.";
    const routePlan = {
      items: [
        {
          id: "museum-thought",
          source: thoughtSource,
          kind: "developing_thought" as const,
          action: null,
          due: null,
          ownerId: null,
          destinations: [{ type: "existing" as const, threadId: "museum-visit" }],
          duplicateActionId: null,
          unresolved: false,
          ambiguity: null,
        },
        {
          id: "museum-check",
          source: actionSource,
          kind: "action" as const,
          action: "Check that the museum booking is confirmed",
          due: null,
          ownerId: null,
          destinations: [],
          duplicateActionId: null,
          unresolved: false,
          ambiguity: null,
        },
      ],
      newThreads: [],
    };
    const recoveryAction = {
      ...recovery,
      clean: source,
      kind: "both" as const,
      actions: ["Check that the museum booking is confirmed"],
      primaryActions: [],
      due: null,
      threadId: "museum-visit",
      threadName: null,
      primaryText: thoughtSource.trim(),
      also: [],
    };
    const recoveryContextDrift = {
      ...recoveryAction,
      kind: "thread" as const,
      actions: [],
      threadId: "museum-visit",
    };
    const plannerPrompts: string[] = [];
    const identityPrompts: string[] = [];
    const arrangeInvocation = (routeRecovery: unknown) => {
      ai.generateObject
        .mockImplementationOnce(async ({ schema }) => ({ object: schema.parse(routeRecovery) }))
        .mockImplementationOnce(async ({ schema, prompt }) => {
          plannerPrompts.push(prompt);
          return { object: schema.parse(routePlan) };
        })
        .mockImplementationOnce(ownershipFromPrompt)
        .mockImplementationOnce(async (options) => {
          const { prompt } = options;
          identityPrompts.push(prompt);
          return semanticFromPrompt({
            actionDecisions: [{
              proposedActionId: "museum-check",
              outcome: "existing",
              existingActionId: "museum-reservation",
              relation: "same_outcome",
              rationale: "Both Actions finish by confirming the museum reservation.",
            }],
          })(options);
        });
    };

    arrangeInvocation(recoveryAction);
    const first = await POST(request({
      raw: source,
      threads: routeThreads,
      actions: existingActions,
      correctionExamples: [],
    }));
    arrangeInvocation(recoveryContextDrift);
    const repeated = await POST(request({
      raw: source,
      threads: routeThreads,
      actions: accumulatedActions,
      correctionExamples: [],
    }));
    const firstBody = await first.json();
    const repeatedBody = await repeated.json();

    expect(first.status).toBe(200);
    expect(repeated.status).toBe(200);
    expect(plannerPrompts).toHaveLength(2);
    const withoutInitialReading = (prompt: string) => prompt.replace(/Initial interpretation \(advisory\):\n[^\n]*\n\n/, "");
    expect(withoutInitialReading(plannerPrompts[1])).toBe(withoutInitialReading(plannerPrompts[0]));
    expect(plannerPrompts[0]).not.toContain(existingActions[0].text);
    expect(plannerPrompts[0]).not.toContain("Recovery interpretation");
    expect(identityPrompts[0]).toContain(existingActions[0].text);
    expect(identityPrompts[1]).toContain(accumulatedActions[1].text);
    expect(firstBody.routingPlan).toEqual(repeatedBody.routingPlan);
    expect(firstBody.routingPlan.items).toEqual([
      routePlan.items[0],
      { ...routePlan.items[1], duplicateActionId: "museum-reservation" },
    ]);
    expect(firstBody).toMatchObject({
      kind: "thread",
      threadId: "museum-visit",
      actions: [],
      primaryText: thoughtSource.trim(),
    });
  });

  it("keeps a cross-domain follow-up Action when its finish line is not covered by an existing Action", async () => {
    const source = "Email the orchard map to the irrigation installer.";
    const existingActions = [{
      id: "orchard-map",
      text: "Finish drawing the orchard irrigation map",
    }];
    const routeRecovery = {
      ...recovery,
      clean: source,
      kind: "action" as const,
      actions: ["Email the orchard map to the irrigation installer"],
      primaryActions: [],
      due: null,
      threadId: null,
      threadName: null,
      primaryText: null,
      also: [],
    };
    const routePlan = {
      items: [{
        id: "send-orchard-map",
        source,
        kind: "action" as const,
        action: "Email the orchard map to the irrigation installer",
        due: null,
        ownerId: null,
        destinations: [],
        duplicateActionId: null,
        unresolved: false,
        ambiguity: null,
      }],
      newThreads: [],
    };
    ai.generateObject
      .mockImplementationOnce(async ({ schema }) => ({ object: schema.parse(routeRecovery) }))
      .mockImplementationOnce(async ({ schema }) => {
        return { object: schema.parse(routePlan) };
      })
      .mockImplementationOnce(async ({ schema, prompt }) => {
        expect(prompt).toContain("Shared subject matter, project, artifact, person, or prerequisite alone is distinct");
        expect(prompt).toContain("a remaining delivery, communication, review, approval, deadline, recipient, or other result is distinct");
        return { object: schema.parse({
          decisions: [{
            proposedActionId: "send-orchard-map",
            outcome: "new",
            closestExistingActionId: "orchard-map",
            relation: "distinct_outcome",
            rationale: "Drawing the map does not deliver it to the installer.",
          }],
        }) };
      });

    const response = await POST(request({
      raw: source,
      threads: [],
      actions: existingActions,
      correctionExamples: [],
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.actions).toEqual(["Email the orchard map to the irrigation installer"]);
    expect(body.actionDetails).toEqual([{
      text: "Email the orchard map to the irrigation installer",
      due: null,
      source,
    }]);
    expect(body.routingPlan).toEqual(routePlan);
    expect(ai.generateObject).toHaveBeenCalledTimes(3);
  });

  it("bounds the complete planned path at recovery, two planner attempts, one destination call, one Action call, and one date call", async () => {
    const incompletePlan = { ...validPlan, items: validPlan.items.slice(0, -1) };
    ai.generateObject
      .mockImplementationOnce(async ({ schema, maxRetries, abortSignal }) => {
        expect(maxRetries).toBe(0);
        expect(abortSignal).toBeInstanceOf(AbortSignal);
        return { object: schema.parse(recovery) };
      })
      .mockImplementationOnce(async ({ schema, maxRetries, abortSignal }) => {
        expect(maxRetries).toBe(0);
        expect(abortSignal).toBeInstanceOf(AbortSignal);
        return { object: schema.parse(incompletePlan) };
      })
      .mockImplementationOnce(async ({ schema, maxRetries, abortSignal }) => {
        expect(maxRetries).toBe(0);
        expect(abortSignal).toBeInstanceOf(AbortSignal);
        return { object: schema.parse(validPlan) };
      })
      .mockImplementationOnce(ownershipFromPrompt);

    const response = await POST(request({ actions }));

    expect(response.status).toBe(200);
    expect((await response.json()).actions).toEqual(["Draft labels tomorrow"]);
    expect(ai.generateObject).toHaveBeenCalledTimes(6);
  });

  it("falls through after malformed Action identity adjudication at the real route seam", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    providers.providerName = "cerebras";
    providers.fallbackProviderName = "groq";
    ai.generateObject
      .mockImplementationOnce(async ({ schema }) => ({ object: schema.parse(recovery) }))
      .mockResolvedValueOnce({ object: validPlan })
      .mockImplementationOnce(ownershipFromPrompt)
      .mockImplementationOnce(semanticFromPrompt({
        actionDecisions: [{
          proposedActionId: "draft-action",
          outcome: "existing",
          existingActionId: "unknown-action",
          relation: "same_outcome",
          rationale: "Synthetic invalid identifier.",
        }],
      }))
      .mockImplementationOnce(ownershipFromPrompt);

    const response = await POST(request({ actions }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.actions).toEqual(["Draft labels tomorrow"]);
    expect(body.via).toBe("groq");
    expect(body.routing).toEqual({
      preferred: "cerebras",
      fallback: true,
      fallbackReason: "provider_failure",
    });
    expect(ai.generateObject).toHaveBeenCalledTimes(6);
    expect(info).toHaveBeenCalledWith("[capture-routing-stage]", {
      stage: "action_identity",
      providerTier: "cerebras",
      result: "rejected",
      code: "ACTION_ID_INVALID",
      itemCount: validPlan.items.length,
      decisionCount: 1,
    });
    expect(info).toHaveBeenCalledWith("[capture-routing-stage]", {
      stage: "action_identity",
      providerTier: "groq",
      result: "accepted",
      code: "SUCCESS",
      itemCount: validPlan.items.length,
      decisionCount: 1,
    });
    expect(JSON.stringify(info.mock.calls)).not.toContain(raw);
    info.mockRestore();
  });

  it.each([
    ["malformed adjudication", async () => ({ object: { decisions: [{
      proposedActionId: "draft-action",
      outcome: "existing",
      existingActionId: "unknown-action",
      relation: "same_outcome",
      rationale: "Synthetic invalid identifier.",
    }] } })],
    ["provider failure", async () => Promise.reject(new Error("identity provider unavailable"))],
    ["deadline abort", async () => Promise.reject(new DOMException("timed out", "AbortError"))],
  ])("fails the planned route closed on %s without compiling a new Action", async (_label, identityResult) => {
    ai.generateObject
      .mockImplementationOnce(async ({ schema }) => ({ object: schema.parse(recovery) }))
      .mockImplementationOnce(async ({ schema }) => ({ object: schema.parse(validPlan) }))
      .mockImplementationOnce(ownershipFromPrompt)
      .mockImplementationOnce(identityResult);

    const response = await POST(request({ actions }));

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "The sort didn't go through." });
    expect(ai.generateObject).toHaveBeenCalledTimes(4);
  });

  it("lets a complete three-destination plan correct a recovery-only semantic misread", async () => {
    const threeRaw =
      "Tea steeping changes with cooler water. Origami reverse folds need clearer diagrams. Kite bridles change stability in gusts.";
    const threeThreads = [
      { id: "tea", name: "Tea notes", about: "Tea steeping experiments." },
      { id: "origami", name: "Origami practice", about: "Origami folds and diagrams." },
      { id: "kites", name: "Kite workshop", about: "Kite bridles and stability." },
    ];
    const recoveryMisread = {
      ...recovery,
      clean: threeRaw,
      kind: "action" as const,
      actions: [
        "Compare tea steeping with cooler water",
        "Clarify the origami reverse-fold diagram",
        "Document kite bridle stability in gusts",
      ],
      due: null,
      threadId: null,
      threadName: null,
      primaryText: null,
      also: [],
    };
    const threePlan = {
      items: [
        {
          id: "tea-thought",
          source: "Tea steeping changes with cooler water. ",
          kind: "developing_thought",
          action: null,
          due: null,
          ownerId: null,
          destinations: [{ type: "existing", threadId: "tea" }],
          duplicateActionId: null,
          unresolved: false,
          ambiguity: null,
        },
        {
          id: "origami-thought",
          source: "Origami reverse folds need clearer diagrams. ",
          kind: "developing_thought",
          action: null,
          due: null,
          ownerId: null,
          destinations: [{ type: "existing", threadId: "origami" }],
          duplicateActionId: null,
          unresolved: false,
          ambiguity: null,
        },
        {
          id: "kite-thought",
          source: "Kite bridles change stability in gusts.",
          kind: "developing_thought",
          action: null,
          due: null,
          ownerId: null,
          destinations: [{ type: "existing", threadId: "kites" }],
          duplicateActionId: null,
          unresolved: false,
          ambiguity: null,
        },
      ],
      newThreads: [],
    };
    ai.generateObject
      .mockImplementationOnce(async ({ schema }) => ({ object: schema.parse(recoveryMisread) }))
      .mockImplementationOnce(async ({ schema, prompt }) => {
        expect(prompt).toContain("PLANNED ROUTING STAGE");
        expect(prompt).toContain("Initial interpretation (advisory)");
        expect(prompt).toContain("Independently decide the final item kinds and explicit Actions");
        expect(prompt).toContain("It is advisory, not authoritative");
        expect(prompt).toContain("An action is a direct instruction or commitment to a discrete task");
        expect(prompt).toContain("A developing_thought is an observation, question, explanation, design idea, option under consideration, or problem the person is trying to understand");
        expect(prompt).toContain("An imperative addresses the person implicitly and does not need a named actor or date");
        expect(prompt).toContain("Thinking about what might work does not adopt a personal stance");
        expect(prompt).toContain("Only developing_thought items may carry destinations");
        expect(prompt).toContain("Use null only when the supplied Threads list is empty");
        expect(prompt).toContain("Copy exact source slices, including punctuation and separator whitespace");
        return { object: schema.parse(threePlan) };
      });

    const response = await POST(request({
      raw: threeRaw,
      threads: threeThreads,
      actions: [],
      correctionExamples: [],
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      planned: true,
      kind: "thread",
      threadId: "tea",
      actions: [],
      also: [
        { threadId: "origami" },
        { threadId: "kites" },
      ],
      routingPlan: threePlan,
      recovery: recoveryMisread,
    });
    expect(ai.generateObject).toHaveBeenCalledTimes(3);
  });

  it.each([
    {
      label: "keeps a separate new subject's descriptive scope with that subject",
      source: "The observatory log should preserve calibration notes. Separately, an oral-history archive could compare regional dialects across three generations.",
      routeThreads: [{ id: "observatory", name: "Observatory log", about: "Telescope calibration and observing notes." }],
      routeRecovery: {
        ...recovery,
        clean: "The observatory log should preserve calibration notes. Separately, an oral-history archive could compare regional dialects across three generations.",
        kind: "thread" as const,
        actions: [],
        due: null,
        threadId: "observatory",
        threadName: null,
        primaryText: "The observatory log should preserve calibration notes.",
        also: [{
          text: "Separately, an oral-history archive could compare regional dialects across three generations.",
          threadId: null,
          threadName: "Regional oral histories",
        }],
      },
      routePlan: {
        items: [
          {
            id: "observatory-thought",
            source: "The observatory log should preserve calibration notes. ",
            kind: "developing_thought" as const,
            action: null,
            due: null,
            ownerId: null,
            destinations: [{ type: "existing" as const, threadId: "observatory" }],
            duplicateActionId: null,
            unresolved: false,
            ambiguity: null,
          },
          {
            id: "archive-thought",
            source: "Separately, an oral-history archive could compare regional dialects across three generations.",
            kind: "developing_thought" as const,
            action: null,
            due: null,
            ownerId: null,
            destinations: [{ type: "new" as const, newThreadKey: "oral-history" }],
            duplicateActionId: null,
            unresolved: false,
            ambiguity: null,
          },
        ],
        newThreads: [{
          key: "oral-history",
          name: "Regional oral histories",
          closestExistingThreadId: "observatory",
          whyNew: "The archive studies language across generations, not telescope observations.",
        }],
      },
    },
    {
      label: "keeps one subject's qualifying details together rather than inventing a split",
      source: "The ceramics notebook should track how ash glaze changes across firing temperatures and clay bodies.",
      routeThreads: [{ id: "ceramics", name: "Ceramics notebook", about: "Clay bodies, glazes, and kiln firings." }],
      routeRecovery: {
        ...recovery,
        clean: "The ceramics notebook should track how ash glaze changes across firing temperatures and clay bodies.",
        kind: "thread" as const,
        actions: [],
        due: null,
        threadId: "ceramics",
        threadName: null,
        primaryText: null,
        also: [],
      },
      routePlan: {
        items: [{
          id: "ceramics-thought",
          source: "The ceramics notebook should track how ash glaze changes across firing temperatures and clay bodies.",
          kind: "developing_thought" as const,
          action: null,
          due: null,
          ownerId: null,
          destinations: [{ type: "existing" as const, threadId: "ceramics" }],
          duplicateActionId: null,
          unresolved: false,
          ambiguity: null,
        }],
        newThreads: [],
      },
    },
  ])("gives the planner cross-domain source-ownership guidance: $label", async ({
    source,
    routeThreads,
    routeRecovery,
    routePlan,
  }) => {
    ai.generateObject
      .mockImplementationOnce(async ({ schema }) => ({ object: schema.parse(routeRecovery) }))
      .mockImplementationOnce(async ({ schema, prompt }) => {
        expect(prompt).toContain("Partition the original source into meaningful items in original order");
        expect(prompt).toContain("An indivisible shared thought may have several destinations");
        expect(prompt).toContain("for independent thoughts, do not copy or union destination sets across items");
        expect(prompt).toContain("Route each developing thought to every Thread where it genuinely belongs");
        return { object: schema.parse(routePlan) };
      });

    const response = await POST(request({
      raw: source,
      threads: routeThreads,
      actions: [],
      correctionExamples: [],
    }));

    expect(response.status).toBe(200);
    expect((await response.json()).routingPlan).toEqual(routePlan);
  });

  it("keeps the exact existing-plus-new fixture source within its independently owned destination shares", async () => {
    const fixtureRaw =
      "Capture search should keep local matches visible while it finds a supported answer. A separate idea to develop is a small rooftop pollinator garden with wind-tolerant herbs and native flowers in lightweight planters.";
    const fixtureThreads = [{
      id: "thread-capture",
      name: "Capture",
      about: "Capture search, local retrieval, and supported answers.",
    }];
    const fixtureRecovery = {
      ...recovery,
      clean: fixtureRaw,
      kind: "thread" as const,
      actions: [],
      due: null,
      threadId: "thread-capture",
      threadName: null,
      primaryText: "Capture search should keep local matches visible while it finds a supported answer.",
      also: [{
        text: "A separate idea to develop is a small rooftop pollinator garden with wind-tolerant herbs and native flowers in lightweight planters.",
        threadId: null,
        threadName: "Rooftop pollinator garden",
      }],
    };
    const fixturePlan = {
      items: [
        {
          id: "capture-search",
          source: "Capture search should keep local matches visible while it finds a supported answer. ",
          kind: "developing_thought" as const,
          action: null,
          due: null,
          ownerId: null,
          destinations: [{ type: "existing" as const, threadId: "thread-capture" }],
          duplicateActionId: null,
          unresolved: false,
          ambiguity: null,
        },
        {
          id: "garden-design",
          source: "A separate idea to develop is a small rooftop pollinator garden with wind-tolerant herbs and native flowers in lightweight planters.",
          kind: "developing_thought" as const,
          action: null,
          due: null,
          ownerId: null,
          destinations: [{ type: "new" as const, newThreadKey: "garden" }],
          duplicateActionId: null,
          unresolved: false,
          ambiguity: null,
        },
      ],
      newThreads: [{
        key: "garden",
        name: "Rooftop pollinator garden",
        closestExistingThreadId: "thread-capture",
        whyNew: "The new subject concerns a physical garden, not Capture search and retrieval.",
      }],
    };
    ai.generateObject
      .mockImplementationOnce(async ({ schema }) => ({ object: schema.parse(fixtureRecovery) }))
      .mockImplementationOnce(async ({ schema }) => ({ object: schema.parse(fixturePlan) }));

    const response = await POST(request({
      raw: fixtureRaw,
      threads: fixtureThreads,
      actions: [],
      correctionExamples: [],
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.routingPlan.items.map((item: { source: string }) => item.source).join("")).toBe(fixtureRaw);
    expect(body).toMatchObject({
      threadId: "thread-capture",
      primaryText: "Capture search should keep local matches visible while it finds a supported answer.",
      also: [{
        text: "A separate idea to develop is a small rooftop pollinator garden with wind-tolerant herbs and native flowers in lightweight planters.",
        threadId: null,
        threadName: "Rooftop pollinator garden",
      }],
    });
  });

  it("uses Cerebras json_object mode without sending the complex schema", async () => {
    providers.providerName = "cerebras";
    const providerPlan = {
      ...validPlan,
      items: [
        ...validPlan.items.slice(0, 2),
        {
          ...validPlan.items[2],
          source: "Draft labels tomorrow.",
        },
      ],
    };
    ai.generateObject
      .mockImplementationOnce(async ({ schema }) => ({ object: schema.parse(recovery) }))
      .mockImplementationOnce(async (options) => {
        expect(options).toMatchObject({
          output: "no-schema",
          maxRetries: 0,
          temperature: 0,
          providerOptions: {
            cerebras: { reasoningEffort: "medium", reasoningFormat: "hidden" },
          },
        });
        expect(options.schema).toBeUndefined();
        expect(options.prompt).toContain("Complete JSON contract");
        return { object: providerPlan };
      })
      .mockImplementationOnce(async (options) => {
        expect(options.output).toBe("no-schema");
        expect(options.schema).toBeUndefined();
        return ownershipFromPrompt(options);
      });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect((await response.json()).routingPlan).toEqual(providerPlan);
    expect(ai.generateObject).toHaveBeenCalledTimes(3);
  });

  it("uses OpenRouter json_object mode for destination adjudication instead of its incompatible discriminated schema", async () => {
    providers.providerName = "openrouter";
    ai.generateObject
      .mockImplementationOnce(async ({ schema }) => ({ object: schema.parse(recovery) }))
      .mockImplementationOnce(async ({ schema }) => ({ object: schema.parse(validPlan) }))
      .mockImplementationOnce(async (options) => {
        expect(options).toMatchObject({ output: "no-schema", maxRetries: 0, temperature: 0 });
        expect(options.schema).toBeUndefined();
        return ownershipFromPrompt(options);
      });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect((await response.json()).routingPlan).toEqual(validPlan);
    expect(ai.generateObject).toHaveBeenCalledTimes(4);
  });

  it("falls through to another provider when a planner candidate fails deterministic validation", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    providers.providerName = "cerebras";
    providers.fallbackProviderName = "groq";
    const invalid = { ...validPlan, items: validPlan.items.slice(0, -1) };
    const plannerPrompts: string[] = [];
    ai.generateObject
      .mockImplementationOnce(async ({ schema }) => ({ object: schema.parse(recovery) }))
      .mockImplementationOnce(async ({ prompt }) => {
        plannerPrompts.push(prompt);
        return { object: invalid };
      })
      .mockImplementationOnce(async ({ schema, prompt }) => {
        plannerPrompts.push(prompt);
        return { object: schema.parse(validPlan) };
      })
      .mockImplementationOnce(ownershipFromPrompt);

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(plannerPrompts).toHaveLength(2);
    expect(plannerPrompts[1]).toBe(plannerPrompts[0]);
    expect(info).toHaveBeenCalledWith("[capture-routing-stage]", expect.objectContaining({
      stage: "planner",
      providerTier: "cerebras",
      result: "rejected",
      code: "SOURCE_NOT_ACCOUNTED",
    }));
    expect(info).toHaveBeenCalledWith("[capture-routing-stage]", expect.objectContaining({
      stage: "planner",
      providerTier: "groq",
      result: "accepted",
      code: "SUCCESS",
    }));
  });

  it("retries the plan once with specific validation feedback", async () => {
    const invalid = { ...validPlan, items: validPlan.items.slice(0, -1) };
    ai.generateObject
      .mockImplementationOnce(async ({ schema }) => ({ object: schema.parse(recovery) }))
      .mockImplementationOnce(async ({ schema }) => ({ object: schema.parse(invalid) }))
      .mockImplementationOnce(async ({ schema, prompt }) => {
        expect(prompt).toContain("SOURCE_NOT_ACCOUNTED");
        return { object: schema.parse(validPlan) };
      });

    const response = await POST(request());
    expect(response.status).toBe(200);
    expect((await response.json()).planned).toBe(true);
    expect(ai.generateObject).toHaveBeenCalledTimes(5);
  });

  it("pinpoints a one-character source mutation so the bounded retry can repair it", async () => {
    const mutatedSource = validPlan.items[0].source.replace(".", "—");
    const invalid = {
      ...validPlan,
      items: validPlan.items.map((item, index) =>
        index === 0 ? { ...item, source: mutatedSource } : item
      ),
    };
    const mismatchOffset = [...raw].findIndex(
      (character, index) => character !== [...invalid.items.map((item) => item.source).join("")][index]
    );

    ai.generateObject
      .mockImplementationOnce(async ({ schema }) => ({ object: schema.parse(recovery) }))
      .mockImplementationOnce(async ({ schema }) => ({ object: schema.parse(invalid) }))
      .mockImplementationOnce(async ({ schema, prompt }) => {
        expect(prompt).toContain("SOURCE_NOT_ACCOUNTED");
        expect(prompt).toContain(JSON.stringify({
          characterOffset: mismatchOffset,
          expected: ".",
          received: "—",
        }));
        expect(prompt).toContain("Immutable indexed source ledger");
        expect(prompt).toContain(`[${mismatchOffset}] U+002E ${JSON.stringify(".")}`);
        return { object: schema.parse(validPlan) };
      });

    const response = await POST(request());
    expect(response.status).toBe(200);
    expect((await response.json()).routingPlan).toEqual(validPlan);
    expect(ai.generateObject).toHaveBeenCalledTimes(5);
  });

  it("indexes cross-domain punctuation and Unicode without normalizing the immutable source", async () => {
    const source = "A luthier’s note says “brace lightly”—then compare café resonance with spruce. Καλημέρα 🌿";
    const routeThreads = [{
      id: "luthiery",
      name: "Luthiery acoustics",
      about: "Instrument bracing, woods, and resonance comparisons.",
    }];
    const routeRecovery = {
      ...recovery,
      clean: source,
      kind: "thread" as const,
      actions: [],
      due: null,
      threadId: "luthiery",
      threadName: null,
      primaryText: null,
      also: [],
    };
    const routePlan = {
      items: [{
        id: "luthiery-thought",
        source,
        kind: "developing_thought" as const,
        action: null,
        due: null,
        ownerId: null,
        destinations: [{ type: "existing" as const, threadId: "luthiery" }],
        duplicateActionId: null,
        unresolved: false,
        ambiguity: null,
      }],
      newThreads: [],
    };
    const indexedCharacters = [...source]
      .map((character, characterOffset) => ({ character, characterOffset }))
      .filter(({ character }) => !/^[\p{L}\p{N} ]$/u.test(character));

    ai.generateObject
      .mockImplementationOnce(async ({ schema }) => ({ object: schema.parse(routeRecovery) }))
      .mockImplementationOnce(async ({ schema, prompt }) => {
        expect(prompt).toContain("Immutable indexed source ledger");
        for (const { character, characterOffset } of indexedCharacters) {
          const codePoint = `U+${character.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`;
          expect(prompt).toContain(`[${characterOffset}] ${codePoint} ${JSON.stringify(character)}`);
        }
        return { object: schema.parse(routePlan) };
      });

    const response = await POST(request({
      raw: source,
      threads: routeThreads,
      actions: [],
      correctionExamples: [],
    }));

    expect(response.status).toBe(200);
    expect((await response.json()).routingPlan.items[0].source).toBe(source);
  });

  it("gives the real route seam enough general guidance to repair routed non-thought items", async () => {
    const invalid = {
      ...validPlan,
      items: validPlan.items.map((item, index) => index === 0
        ? { ...item, kind: "action" as const, action: "Explain Capture filing" }
        : item),
    };
    ai.generateObject
      .mockImplementationOnce(async ({ schema }) => ({ object: schema.parse(recovery) }))
      .mockImplementationOnce(async ({ schema }) => ({ object: schema.parse(invalid) }))
      .mockImplementationOnce(async ({ schema, prompt }) => {
        expect(prompt).toContain("NON_THOUGHT_DESTINATION");
        expect(prompt).toContain("Re-evaluate each affected item's semantic kind from the original source");
        expect(prompt).toContain("Do not mechanically clear destinations");
        expect(prompt).toContain("An action is a direct instruction or commitment to a discrete task");
        expect(prompt).toContain("A developing_thought is an observation, question, explanation, design idea, option under consideration, or problem the person is trying to understand");
        expect(prompt).toContain("An imperative addresses the person implicitly and does not need a named actor or date");
        expect(prompt).toContain("Thinking about what might work does not adopt a personal stance");
        expect(prompt).toContain("Only developing_thought items may carry destinations");
        return { object: schema.parse(validPlan) };
      });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect((await response.json()).routingPlan).toEqual(validPlan);
    expect(ai.generateObject).toHaveBeenCalledTimes(5);
  });

  it.each([
    {
      label: "tomorrow across a year boundary",
      now: "2026-12-31T12:00:00",
      today: "Today is Thursday, 2026-12-31.",
      source: "Catalog the field recording archive tomorrow.",
      actionSource: "Catalog the field recording archive",
      deadlineSource: " tomorrow.",
      action: "Catalog the field recording archive tomorrow",
      due: "2027-01-01",
    },
    {
      label: "next Friday when today is Friday across a month boundary",
      now: "2026-01-30T12:00:00",
      today: "Today is Friday, 2026-01-30.",
      source: "Inspect the greenhouse sensors next Friday.",
      actionSource: "Inspect the greenhouse sensors",
      deadlineSource: " next Friday.",
      action: "Inspect the greenhouse sensors next Friday",
      due: "2026-02-06",
    },
  ])("carries the general relative-date contract through the route: $label", async ({
    now,
    today,
    source,
    actionSource,
    deadlineSource,
    action,
    due,
  }) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(now));
    try {
      const routeRecovery = {
        ...recovery,
        clean: source,
        kind: "action" as const,
        actions: [action],
        due,
        threadId: null,
        threadName: null,
        primaryText: null,
        also: [],
      };
      const routePlan = {
        items: [
          {
            id: "owned-action",
            source: actionSource,
            kind: "action" as const,
            action,
            due: null,
            ownerId: null,
            destinations: [],
            duplicateActionId: null,
            unresolved: false,
            ambiguity: null,
          },
          {
            id: "owned-deadline",
            source: deadlineSource,
            kind: "deadline" as const,
            action: null,
            due,
            ownerId: "owned-action",
            destinations: [],
            duplicateActionId: null,
            unresolved: false,
            ambiguity: null,
          },
        ],
        newThreads: [],
      };
      ai.generateObject
        .mockImplementationOnce(async ({ schema }) => ({ object: schema.parse(routeRecovery) }))
        .mockImplementationOnce(async ({ schema, prompt }) => {
          expect(prompt).toContain(today);
          expect(prompt).toContain(
            '"tomorrow" means the next local calendar day, including across month or year boundaries'
          );
          expect(prompt).toContain(
            "the next calendar occurrence of that weekday strictly after today"
          );
          expect(prompt).toContain("If today is that weekday, use the date seven days later");
          expect(prompt).toContain(
            "verify that the resolved ISO date falls on the named weekday"
          );
          return { object: schema.parse(routePlan) };
        });

      const response = await POST(request({
        raw: source,
        threads: [],
        actions: [],
        correctionExamples: [],
      }));

      expect(response.status).toBe(200);
      expect((await response.json()).actionDetails).toEqual([{
        text: action,
        due,
        source,
      }]);
      expect(ai.generateObject).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    {
      label: "bread and astronomy",
      source: "Bread trials should compare crumb after cooler proofs. Astronomy notes need a clearer way to track lens fog. Photograph the next loaf tomorrow. Calibrate the dew heater next Friday.",
      firstThread: "bread",
      secondThread: "astronomy",
    },
    {
      label: "orchids and oral history",
      source: "Orchid notes should compare root growth across bark mixes. Oral-history notes need clearer speaker-turn markers. Photograph the orchid roots tomorrow. Export the interview index next Friday.",
      firstThread: "orchids",
      secondThread: "oral-history",
    },
  ])("audits independent Thread shares and Action deadlines at the real route seam: $label", async ({
    source,
    firstThread,
    secondThread,
  }) => {
    const routeRecovery = {
      ...recovery,
      clean: source,
      kind: "both" as const,
      actions: ["First synthetic action", "Second synthetic action"],
      due: null,
      threadId: firstThread,
      primaryText: source.split(". ")[0] + ".",
      also: [{ text: source.split(". ")[1] + ".", threadId: secondThread, threadName: null }],
    };
    const parts = source.match(/^(.+?\. )(.+?\. )(.+?)( tomorrow\. )(.+?)( next Friday\.)$/);
    expect(parts).not.toBeNull();
    const routePlan = {
      items: [
        { id: "first-thought", source: parts![1], kind: "developing_thought", action: null, due: null, ownerId: null, destinations: [{ type: "existing", threadId: firstThread }], duplicateActionId: null, unresolved: false, ambiguity: null },
        { id: "second-thought", source: parts![2], kind: "developing_thought", action: null, due: null, ownerId: null, destinations: [{ type: "existing", threadId: secondThread }], duplicateActionId: null, unresolved: false, ambiguity: null },
        { id: "first-action", source: parts![3], kind: "action", action: "First synthetic action", due: null, ownerId: null, destinations: [], duplicateActionId: null, unresolved: false, ambiguity: null },
        { id: "first-deadline", source: parts![4], kind: "deadline", action: null, due: "2026-10-28", ownerId: "first-action", destinations: [], duplicateActionId: null, unresolved: false, ambiguity: null },
        { id: "second-action", source: parts![5], kind: "action", action: "Second synthetic action", due: null, ownerId: null, destinations: [], duplicateActionId: null, unresolved: false, ambiguity: null },
        { id: "second-deadline", source: parts![6], kind: "deadline", action: null, due: "2026-10-30", ownerId: "second-action", destinations: [], duplicateActionId: null, unresolved: false, ambiguity: null },
      ],
      newThreads: [],
    };
    ai.generateObject
      .mockImplementationOnce(async ({ schema }) => ({ object: schema.parse(routeRecovery) }))
      .mockImplementationOnce(async ({ schema, prompt }) => {
        expect(prompt).toContain("Give it only destinations that own that exact item.source");
        expect(prompt).toContain("do not copy or union destination sets across items");
        expect(prompt).toContain("Confirm that ownerId plus additionalOwnerIds names exactly the intended scope");
        expect(prompt).toContain("excluding Actions with differing local dates");
        expect(prompt).toContain("do not copy or union dates or owners across sibling Actions");
        return { object: schema.parse(routePlan) };
      });

    const response = await POST(request({
      raw: source,
      threads: [
        { id: firstThread, name: "First synthetic domain", about: "Only the first synthetic subject." },
        { id: secondThread, name: "Second synthetic domain", about: "Only the second synthetic subject." },
      ],
      actions: [],
      correctionExamples: [],
    }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.routingPlan.items.slice(0, 2).map((item: { destinations: unknown[] }) => item.destinations))
      .toEqual(routePlan.items.slice(0, 2).map((item) => item.destinations));
    expect(body.actionDetails.map(({ due }: { due: string | null }) => due))
      .toEqual(["2026-09-30", "2026-10-02"]);
  });

  it("repairs a cross-domain mixed thought plus two Actions into separate owned deadlines", async () => {
    const mixedRaw = "Fermentation notes should compare aroma after cold proofing. Meteor log design needs a clearer way to mark cloud cover. Photograph the next loaf tomorrow. Export the meteor chart next Friday.";
    const mixedThreads = [
      { id: "fermentation", name: "Fermentation notes", about: "Cold proofing, aroma, and bread trials." },
      { id: "meteors", name: "Meteor log", about: "Meteor observations and chart design." },
    ];
    const mixedRecovery = {
      ...recovery,
      clean: mixedRaw,
      actions: ["Photograph the next loaf tomorrow", "Export the meteor chart next Friday"],
      due: null,
      threadId: "fermentation",
      primaryText: "Fermentation notes should compare aroma after cold proofing.",
      also: [{ text: "Meteor log design needs a clearer way to mark cloud cover.", threadId: "meteors", threadName: null }],
    };
    const invalid = {
      items: [
        { id: "bread-thought", source: "Fermentation notes should compare aroma after cold proofing. ", kind: "developing_thought", action: null, due: null, ownerId: null, destinations: [{ type: "existing", threadId: "fermentation" }], duplicateActionId: null, unresolved: false, ambiguity: null },
        { id: "meteor-thought", source: "Meteor log design needs a clearer way to mark cloud cover. ", kind: "developing_thought", action: null, due: null, ownerId: null, destinations: [{ type: "existing", threadId: "meteors" }], duplicateActionId: null, unresolved: false, ambiguity: null },
        { id: "photo-action", source: "Photograph the next loaf tomorrow. ", kind: "action", action: "Photograph the next loaf tomorrow", due: "2026-10-28", ownerId: null, destinations: [], duplicateActionId: null, unresolved: false, ambiguity: null },
        { id: "export-action", source: "Export the meteor chart next Friday.", kind: "action", action: "Export the meteor chart next Friday", due: "2026-10-30", ownerId: null, destinations: [], duplicateActionId: null, unresolved: false, ambiguity: null },
      ],
      newThreads: [],
    };
    const corrected = {
      items: [
        ...invalid.items.slice(0, 2),
        { ...invalid.items[2], source: "Photograph the next loaf", due: null },
        { id: "photo-deadline", source: " tomorrow.", kind: "deadline", action: null, due: "2026-10-28", ownerId: "photo-action", destinations: [], duplicateActionId: null, unresolved: false, ambiguity: null },
        { ...invalid.items[3], source: "Export the meteor chart", due: null },
        { id: "export-deadline", source: " next Friday.", kind: "deadline", action: null, due: "2026-10-30", ownerId: "export-action", destinations: [], duplicateActionId: null, unresolved: false, ambiguity: null },
      ],
      newThreads: [],
    };
    ai.generateObject
      .mockImplementationOnce(async ({ schema }) => ({ object: schema.parse(mixedRecovery) }))
      .mockImplementationOnce(async ({ schema }) => ({ object: schema.parse(invalid) }))
      .mockImplementationOnce(async ({ schema, prompt }) => {
        expect(prompt).toContain("DEADLINE_NOT_ATOMIC repair");
        expect(prompt).toContain("Action.due must be null");
        expect(prompt).toContain("relative phrase, punctuation, and adjacent separator whitespace");
        return { object: schema.parse(corrected) };
      });

    const response = await POST(request({
      raw: mixedRaw,
      threads: mixedThreads,
      actions: [],
      correctionExamples: [],
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.routingPlan.items.filter((item: { kind: string }) => item.kind === "action")
      .map((item: { due: string | null }) => item.due)).toEqual([null, null]);
    expect(body.actionDetails).toMatchObject([
      { text: "Photograph the next loaf tomorrow", due: "2026-09-30" },
      { text: "Export the meteor chart next Friday", due: "2026-10-02" },
    ]);
    expect(body.routingPlan.items.map((item: { source: string }) => item.source).join(""))
      .toBe(mixedRaw);
    expect(ai.generateObject).toHaveBeenCalledTimes(5);
  });

  it("adjudicates the exact mixed-subject shape before compile while preserving Actions and deadlines", async () => {
    const source = "The TechTutor mystery should reveal why one prompt is underspecified, while Retake marker jumps need a calmer loading transition. Draft two mystery variants tomorrow. Review the Retake playback notes next Friday.";
    const thoughtSource = "The TechTutor mystery should reveal why one prompt is underspecified, while Retake marker jumps need a calmer loading transition. ";
    const routeThreads = [
      { id: "thread-techtutor", name: "TechTutor lessons", about: "Lesson mysteries and prompt exercises." },
      { id: "thread-retake", name: "Retake workflow", about: "Playback markers and loading transitions." },
    ];
    const existingActions = [
      { id: "existing-mystery", text: "Publish the finished mystery lesson" },
      { id: "existing-retake", text: "Send the Retake playback summary" },
    ];
    const routeRecovery = {
      ...recovery,
      clean: source,
      kind: "both" as const,
      actions: ["Draft two mystery variants", "Review the Retake playback notes"],
      due: null,
      threadId: "thread-techtutor",
      primaryText: thoughtSource.trim(),
      also: [],
    };
    const unsafePlan = {
      items: [
        {
          id: "mixed-thought",
          source: thoughtSource,
          kind: "developing_thought" as const,
          action: null,
          due: null,
          ownerId: null,
          destinations: [
            { type: "existing" as const, threadId: "thread-techtutor" },
            { type: "existing" as const, threadId: "thread-retake" },
          ],
          duplicateActionId: null,
          unresolved: false,
          ambiguity: null,
        },
        {
          id: "draft",
          source: "Draft two mystery variants",
          kind: "action" as const,
          action: "Draft two mystery variants",
          due: null,
          ownerId: null,
          destinations: [],
          duplicateActionId: null,
          unresolved: false,
          ambiguity: null,
        },
        {
          id: "draft-due",
          source: " tomorrow. ",
          kind: "deadline" as const,
          action: null,
          due: "2026-09-30",
          ownerId: "draft",
          destinations: [],
          duplicateActionId: null,
          unresolved: false,
          ambiguity: null,
        },
        {
          id: "review",
          source: "Review the Retake playback notes",
          kind: "action" as const,
          action: "Review the Retake playback notes",
          due: null,
          ownerId: null,
          destinations: [],
          duplicateActionId: null,
          unresolved: false,
          ambiguity: null,
        },
        {
          id: "review-due",
          source: " next Friday.",
          kind: "deadline" as const,
          action: null,
          due: "2026-10-01",
          ownerId: "review",
          destinations: [],
          duplicateActionId: null,
          unresolved: false,
          ambiguity: null,
        },
      ],
      newThreads: [],
    };
    ai.generateObject
      .mockImplementationOnce(async ({ schema }) => ({ object: schema.parse(routeRecovery) }))
      .mockImplementationOnce(async ({ schema }) => ({ object: schema.parse(unsafePlan) }))
      .mockImplementationOnce(async ({ schema, prompt, maxRetries, abortSignal }) => {
        expect(prompt).toContain("DESTINATION AND SUBJECT-BOUNDARY ADJUDICATION");
        expect(prompt).not.toContain("Action identity");
        expect(prompt).not.toContain("deadlineDecisions");
        expect(prompt).not.toContain("currentDue");
        expect(prompt).toContain(JSON.stringify(routeThreads));
        expect(prompt).toContain(JSON.stringify(thoughtSource));
        expect(maxRetries).toBe(0);
        expect(abortSignal).toBeInstanceOf(AbortSignal);
        const destinations = {
          decisions: [{
            itemId: "mixed-thought",
            mode: "split",
            spans: [
              {
                start: 0,
                end: 70,
                destinations: [{ type: "existing", threadId: "thread-techtutor" }],
              },
              {
                start: 70,
                end: 130,
                destinations: [{ type: "existing", threadId: "thread-retake" }],
              },
            ],
          }],
        };
        return { object: schema ? schema.parse(destinations) : destinations };
      })
      .mockImplementationOnce(async ({ schema, prompt, maxRetries, abortSignal }) => {
        expect(prompt).toContain("ACTION IDENTITY ADJUDICATION");
        expect(prompt).toContain(JSON.stringify(existingActions));
        expect(prompt).not.toContain("Available existing Threads");
        expect(prompt).not.toContain("destinationDecisions");
        expect(prompt).not.toContain("calendarOperation");
        expect(maxRetries).toBe(0);
        expect(abortSignal).toBeInstanceOf(AbortSignal);
        const identities = {
          decisions: [
            { proposedActionId: "draft", outcome: "new", closestExistingActionId: "existing-mystery", relation: "distinct_outcome", rationale: "Drafting variants is distinct from publishing a finished lesson." },
            { proposedActionId: "review", outcome: "new", closestExistingActionId: "existing-retake", relation: "distinct_outcome", rationale: "Reviewing notes is distinct from sending a summary." },
          ],
        };
        return { object: schema ? schema.parse(identities) : identities };
      })
      .mockImplementationOnce(async ({ schema, prompt, maxRetries, abortSignal }) => {
        expect(prompt).toContain("PLANNED DEADLINE ADJUDICATION");
        expect(prompt).toContain('"id":"draft-due"');
        expect(prompt).toContain('"source":" tomorrow. "');
        expect(prompt).toContain('"ownerActionId":"draft"');
        expect(prompt).toContain('"id":"review-due"');
        expect(prompt).toContain('"source":" next Friday."');
        expect(prompt).toContain('"ownerActionId":"review"');
        expect(prompt).not.toContain("2026-10-01");
        expect(maxRetries).toBe(0);
        expect(abortSignal).toBeInstanceOf(AbortSignal);
        const dates = {
          decisions: [
            {
              deadlineItemId: "draft-due",
              ownerActionId: "draft",
              due: "2026-09-30",
              calendarOperation: { type: "day_offset", days: 1 },
            },
            {
              deadlineItemId: "review-due",
              ownerActionId: "review",
              due: "2026-10-02",
              calendarOperation: {
                type: "next_weekday",
                weekday: "friday",
                occurrence: "strictly_after_today",
              },
            },
          ],
        };
        return { object: schema ? schema.parse(dates) : dates };
      });

    const response = await POST(request({
      raw: source,
      threads: routeThreads,
      actions: existingActions,
      correctionExamples: [],
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.primaryText).toBe("The TechTutor mystery should reveal why one prompt is underspecified,");
    expect(body.also).toEqual([{
      text: "while Retake marker jumps need a calmer loading transition.",
      threadId: "thread-retake",
      threadName: null,
    }]);
    expect(body.actionDetails).toEqual([
      { text: "Draft two mystery variants", due: "2026-09-30", source: "Draft two mystery variants tomorrow. " },
      { text: "Review the Retake playback notes", due: "2026-10-02", source: "Review the Retake playback notes next Friday." },
    ]);
    expect(body.routingPlan.items.map((item: { source: string }) => item.source).join("")).toBe(source);
    expect(body.routingPlan.items.slice(2)).toEqual(
      unsafePlan.items.slice(1).map((item) =>
        item.id === "review-due" ? { ...item, due: "2026-10-02" } : item),
    );
    expect(ai.generateObject).toHaveBeenCalledTimes(5);
  });

  it.each([
    ["malformed output", semanticFromPrompt({ destinationDecisions: [] }), "COVERAGE_INVALID"],
    ["provider failure", async () => Promise.reject(new Error("destination provider unavailable")), "PROVIDER_OR_OUTPUT_FAILURE"],
    ["timeout", async () => Promise.reject(new DOMException("timed out", "AbortError")), "ABORTED"],
  ])("falls through after destination adjudication %s at the real route seam", async (
    _label,
    firstDestinationResult,
    expectedCode,
  ) => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    providers.providerName = "cerebras";
    providers.fallbackProviderName = "groq";
    const collapsedPlan = {
      ...validPlan,
      items: [{
        ...validPlan.items[0],
        source: validPlan.items[0].source + validPlan.items[1].source,
        destinations: [
          { type: "existing" as const, threadId: "capture" },
          { type: "existing" as const, threadId: "retake" },
        ],
      }, ...validPlan.items.slice(2)],
    };
    ai.generateObject
      .mockImplementationOnce(async ({ schema }) => ({ object: schema.parse(recovery) }))
      .mockResolvedValueOnce({ object: collapsedPlan })
      .mockImplementationOnce(firstDestinationResult)
      .mockImplementationOnce(semanticFromPrompt({
        destinationDecisions: [{
          itemId: validPlan.items[0].id,
          mode: "split",
          spans: [
            { start: 0, end: [...validPlan.items[0].source].length, destinations: validPlan.items[0].destinations },
            {
              start: [...validPlan.items[0].source].length,
              end: [...(validPlan.items[0].source + validPlan.items[1].source)].length,
              destinations: validPlan.items[1].destinations,
            },
          ],
        }],
      }));

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect((await response.json()).routingPlan.items).toHaveLength(validPlan.items.length);
    expect(ai.generateObject).toHaveBeenCalledTimes(5);
    expect(info).toHaveBeenCalledWith("[capture-routing-stage]", {
      stage: "destination_adjudication",
      providerTier: "cerebras",
      result: "rejected",
      code: expectedCode,
      itemCount: 3,
      decisionCount: 1,
    });
    expect(info).toHaveBeenCalledWith("[capture-routing-stage]", {
      stage: "destination_adjudication",
      providerTier: "groq",
      result: "accepted",
      code: "SUCCESS",
      itemCount: 4,
      decisionCount: 1,
    });
  });

  it.each([
    ["malformed deadline decision", async () => ({ object: { decisions: [] } }), "COVERAGE_INVALID"],
    ["deadline provider failure", async () => Promise.reject(new Error("date provider unavailable")), "PROVIDER_OR_OUTPUT_FAILURE"],
    ["deadline timeout", async () => Promise.reject(new DOMException("timed out", "AbortError")), "ABORTED"],
  ])("falls through to the next provider after %s", async (_label, firstDateResult, expectedCode) => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    providers.providerName = "cerebras";
    providers.fallbackProviderName = "groq";
    ai.generateObject
      .mockImplementationOnce(async ({ schema }) => ({ object: schema.parse(recovery) }))
      .mockResolvedValueOnce({ object: validPlan })
      .mockImplementationOnce(semanticFromPrompt())
      .mockImplementationOnce(firstDateResult)
      .mockImplementationOnce(ownershipFromPrompt);

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect((await response.json()).routingPlan.items.find(
      (item: { id: string }) => item.id === "draft-due",
    ).due).toBe("2026-09-30");
    expect(ai.generateObject).toHaveBeenCalledTimes(5);
    expect(info).toHaveBeenCalledWith("[capture-routing-stage]", {
      stage: "deadline_adjudication",
      providerTier: "cerebras",
      result: "rejected",
      code: expectedCode,
      itemCount: validPlan.items.length,
      decisionCount: 1,
    });
    expect(info).toHaveBeenCalledWith("[capture-routing-stage]", {
      stage: "deadline_adjudication",
      providerTier: "groq",
      result: "accepted",
      code: "SUCCESS",
      itemCount: validPlan.items.length,
      decisionCount: 1,
    });
  });

  it.each([
    ["malformed deadline output", async () => ({ object: { decisions: [] } })],
    ["deadline provider failure", async () => Promise.reject(new Error("date provider unavailable"))],
    ["deadline timeout", async () => Promise.reject(new DOMException("timed out", "AbortError"))],
  ])("fails the whole planned route closed on %s after earlier stages succeed", async (_label, dateResult) => {
    ai.generateObject
      .mockImplementationOnce(async ({ schema }) => ({ object: schema.parse(recovery) }))
      .mockImplementationOnce(async ({ schema }) => ({ object: schema.parse(validPlan) }))
      .mockImplementationOnce(semanticFromPrompt())
      .mockImplementationOnce(dateResult);

    const response = await POST(request());

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "The sort didn't go through." });
    expect(ai.generateObject).toHaveBeenCalledTimes(4);
  });

  it("skips the date model call when the validated plan has no deadline items", async () => {
    const source = "Send the museum confirmation.";
    const routeRecovery = {
      ...recovery,
      clean: source,
      kind: "action" as const,
      actions: ["Send the museum confirmation"],
      due: null,
      threadId: null,
      threadName: null,
      primaryText: null,
      also: [],
    };
    const routePlan = {
      items: [{
        id: "send-confirmation",
        source,
        kind: "action" as const,
        action: "Send the museum confirmation",
        due: null,
        ownerId: null,
        destinations: [],
        duplicateActionId: null,
        unresolved: false,
        ambiguity: null,
      }],
      newThreads: [],
    };
    ai.generateObject
      .mockImplementationOnce(async ({ schema }) => ({ object: schema.parse(routeRecovery) }))
      .mockImplementationOnce(async ({ schema }) => ({ object: schema.parse(routePlan) }));

    const response = await POST(request({
      raw: source,
      threads: [],
      actions: [],
      correctionExamples: [],
    }));

    expect(response.status).toBe(200);
    expect((await response.json()).routingPlan).toEqual(routePlan);
    expect(ai.generateObject).toHaveBeenCalledTimes(2);
    expect(ai.generateObject.mock.calls.some(([options]) =>
      options.prompt.includes("PLANNED DEADLINE ADJUDICATION")
    )).toBe(false);
  });

  it.each([
    ["malformed ownership", async () => ({ object: { decisions: [] } })],
    ["ownership provider failure", async () => Promise.reject(new Error("ownership provider unavailable"))],
    ["ownership deadline abort", async () => Promise.reject(new DOMException("timed out", "AbortError"))],
  ])("fails the planned route closed on %s", async (_label, ownershipResult) => {
    ai.generateObject
      .mockImplementationOnce(async ({ schema }) => ({ object: schema.parse(recovery) }))
      .mockImplementationOnce(async ({ schema }) => ({ object: schema.parse(validPlan) }))
      .mockImplementationOnce(ownershipResult);

    const response = await POST(request());

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "The sort didn't go through." });
    expect(ai.generateObject).toHaveBeenCalledTimes(3);
  });

  it("records only fixed validation codes, attempt number, and structural counts", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const invalid = { ...validPlan, items: validPlan.items.slice(0, -1) };
    ai.generateObject
      .mockImplementationOnce(async ({ schema }) => ({ object: schema.parse(recovery) }))
      .mockImplementationOnce(async ({ schema }) => ({ object: schema.parse(invalid) }))
      .mockImplementationOnce(async ({ schema }) => ({ object: schema.parse(validPlan) }));

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(info).toHaveBeenCalledWith("[capture-routing-validation]", {
      attempt: 1,
      failureCodes: ["SOURCE_NOT_ACCOUNTED"],
      itemCount: 3,
      destinationCount: 2,
      newThreadCount: 0,
      sourceCharacterCount: raw.length,
      accountedSourceCharacterCount: invalid.items.reduce(
        (count, item) => count + item.source.length,
        0
      ),
      matchingPrefixCharacterCount: invalid.items.map((item) => item.source).join("").length,
      matchingSuffixCharacterCount: 0,
    });
    expect(info).toHaveBeenCalledWith("[capture-routing-validation]", {
      attempt: 2,
      failureCodes: [],
      itemCount: 4,
      destinationCount: 2,
      newThreadCount: 0,
      sourceCharacterCount: raw.length,
      accountedSourceCharacterCount: raw.length,
      matchingPrefixCharacterCount: raw.length,
      matchingSuffixCharacterCount: raw.length,
    });
    expect(JSON.stringify(info.mock.calls)).not.toContain(raw);
    info.mockRestore();
  });

  it("fails closed after one malformed-plan retry and exposes no diagnostics", async () => {
    providers.providerName = "cerebras";
    ai.generateObject
      .mockImplementationOnce(async ({ schema }) => ({ object: schema.parse(recovery) }))
      .mockResolvedValueOnce({ object: { malformed: true } })
      .mockImplementationOnce(async ({ prompt }) => {
        expect(prompt).toContain("MALFORMED_PLAN");
        return { object: ["still malformed"] };
      });

    const response = await POST(request());
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body).toEqual({ error: "The sort didn't go through." });
    expect(JSON.stringify(body)).not.toContain("malformed");
    expect(ai.generateObject).toHaveBeenCalledTimes(3);
  });
});
