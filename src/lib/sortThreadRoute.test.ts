import { afterEach, expect, it, vi } from "vitest";
import { applySorted } from "./boardOps";
import { actionsForThread } from "./threadActions";
import { EMPTY } from "./model";
import { recordSortedCapture } from "./settle";
import liveResponses from "./sortLiveResponses.json";
import { reconcileSorted } from "./sort";
import type { SortResult } from "./boardOps";

// Exact allowlisted HTTP responses from the two 2026-09-13 Cerebras calls.
// They are post-route responses, not invented ideal outputs or raw transcripts.
it.each(Object.entries(liveResponses))("replays real %s response without minting errand threads", async (_name, payload) => {
  ai.generateObject.mockImplementation(async ({ schema }) => ({ object: schema.parse(payload) }));
  const board = { ...EMPTY, threads: [{ id: "pricing", name: "Annual pricing", summary: payload.primaryText, frags: [] }] };
  const before = structuredClone(board);
  const response = await POST(new Request("http://localhost/api/sort", { method: "POST", body: JSON.stringify({ raw: payload.clean, threads: [{ id: "pricing", name: "Annual pricing", about: payload.primaryText }] }) }));
  expect(response.status).toBe(200);
  const routed = await response.json();
  // Both server reconciliation and direct helper entry must protect older responses.
  for (const out of [routed, reconcileSorted(payload as SortResult), payload as SortResult]) {
    const applied = applySorted(out, [], 1000, board);
    const { next } = applied;
    const recorded = recordSortedCapture(next, {
      raw: payload.clean, payload: payload.clean, clean: out.clean, kind: out.kind,
      primaryText: out.primaryText, at: 1000, dictated: false, imgIds: [], captureId: "live-replay",
      primary: { targetId: applied.targetId!, fragId: applied.source?.fragId },
      also: applied.alsoLanded ?? [],
    }, () => "replay-record").board;
    expect(recorded.ledger[0].raw).toBe(payload.clean);
    expect(recorded.ledger[0].clean).toBe(payload.clean);
    expect(next.threads.map(t => t.id)).toEqual(["pricing"]);
    expect(next.actions.map(a => a.src)).toEqual(payload.actions);
    expect(actionsForThread(next, next.threads[0]).open.map(a => a.text)).toEqual(payload.primaryActions);
    expect(next.threads[0].frags[0].text).toBe(payload.primaryText);
    expect(out.clean).toBe(payload.clean);
  }
  expect(board).toEqual(before);
});

it("does not broadcast the real mom deadline to unrelated sibling actions", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-13T12:00:00Z"));
  try {
    const payload = liveResponses.unrelated as SortResult;
    ai.generateObject.mockImplementation(async ({ schema }) => ({ object: schema.parse(payload) }));
    const response = await POST(new Request("http://localhost/api/sort", { method: "POST", body: JSON.stringify({ raw: payload.clean, threads: [] }) }));
    const routed = await response.json();
    expect(routed.due).toBeNull();
    for (const out of [routed, payload]) {
      const { next } = applySorted(out, [], Date.now(), EMPTY);
      expect(next.actions.map(a => a.due)).toEqual([null, null]);
      expect(next.actions[1].text).toBe("Call mom this weekend");
      expect(out.clean).toBe(payload.clean);
    }
  } finally { vi.useRealTimers(); }
});

const ai = vi.hoisted(() => ({ generateObject: vi.fn(), generateText: vi.fn() }));
const jev = vi.hoisted(() => ({ scheduleJevThreadRerankShadow: vi.fn() }));
vi.mock("ai", () => ai);
vi.mock("@/lib/jevThreadRerank", () => jev);
vi.mock("@/lib/clientIp", () => ({ clientIp: () => "synthetic" }));
vi.mock("@/lib/limiter", () => ({ modelRateLimit: () => ({ allowed: true }) }));
vi.mock("@/lib/providers", () => ({
  NoProvidersError: class extends Error {},
  sanitizeProviderError: () => "synthetic provider rejection",
  withFallback: async (call: (tier: object) => Promise<unknown>) => ({ value: await call({ model: "mock-no-provider" }), via: "mock-no-provider" }),
}));
import { POST } from "@/app/api/sort/route";
afterEach(() => vi.restoreAllMocks());

const thinking = "I am debating annual pricing versus monthly pricing.";
const raw = `Fix the Stripe webhook retry bug. ${thinking} Call mom this weekend.`;
const modelResult = {
  clean: raw, kind: "both", title: "Pricing and errands", actions: ["Fix the Stripe webhook retry bug", "Call mom this weekend"],
  primaryActions: [], primaryText: thinking, threadId: "pricing", threadName: null, also: [], shelfLife: "keep", due: null,
};

it.each([undefined, null, [0], [999], "0", {}].map(selection => [selection]))("provider schema rejects invalid selection %j (no implied default)", async (selection) => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  ai.generateObject.mockImplementation(async ({ schema }) => ({ object: schema.parse({ ...modelResult, primaryActions: selection }) }));
  const response = await POST(new Request("http://localhost/api/sort", { method: "POST", body: JSON.stringify({ raw, threads: [] }) }));
  expect(response.status).toBeGreaterThanOrEqual(400);
});

it.each([undefined, "intention"])("prompt agrees with the intention array schema (force %s)", async (force) => {
  ai.generateObject.mockImplementation(async ({ schema, prompt }) => {
    expect(prompt).not.toMatch(/Leave "actions" and (?:both |the )?thread fields null/);
    const object = schema.parse({ ...modelResult, kind: "intention", actions: [], primaryActions: [], threadId: null, primaryText: null });
    expect(schema.safeParse({ ...object, actions: null }).success).toBe(false);
    return { object };
  });
  const response = await POST(new Request("http://localhost/api/sort", { method: "POST", body: JSON.stringify({ raw: "I live somewhere with light", threads: [], force }) }));
  expect(response.status).toBe(200);
  expect((await response.json()).actions).toEqual([]);
});

it("prompt reserves clean for the whole capture, primaryText for thinking", async () => {
  ai.generateObject.mockImplementation(async ({ schema, prompt }) => {
    expect(prompt).not.toContain('"clean" holds the thinking');
    expect(prompt).not.toContain('let "clean" carry the whole of the rest');
    expect(prompt).toContain('"clean" retains the whole capture');
    expect(prompt).toContain('"primaryText"');
    expect(prompt).toContain("Never put action-only material in also");
    expect(prompt).toContain("With multiple actions, set due to null");
    return { object: schema.parse(modelResult) };
  });
  const response = await POST(new Request("http://localhost/api/sort", { method: "POST", body: JSON.stringify({ raw, threads: [] }) }));
  expect(response.status).toBe(200);
});

const actionBoundaryFixtures = [
  {
    label: "ongoing observation scope",
    raw: "I want to keep a field journal of which shaded corners stay coolest through summer.",
  },
  {
    label: "hoped-for understanding",
    raw: "I hope to understand why the rehearsal feels easier after a quiet opening.",
  },
  {
    label: "discrete wanted errand",
    raw: "I want to return the library books after lunch.",
  },
  {
    label: "discrete wanted commitment",
    raw: "I want to send Priya the revised estimate before Friday.",
  },
];

it.each(actionBoundaryFixtures)(
  "gives the provider a general observation-versus-action contract for $label",
  async ({ raw: fixtureRaw }) => {
    ai.generateObject.mockImplementation(async ({ schema, prompt }) => {
      expect(prompt).toContain(fixtureRaw);
      expect(prompt).toContain(
        "A desire to keep noticing, tracking, documenting, learning about, or understanding a subject is developing thought",
      );
      expect(prompt).toContain('The words "I want to" do not decide the kind');
      expect(prompt).toContain(
        "A discrete requested act such as an errand, delivery, booking, message, or purchase is still an action",
      );
      expect(schema.shape.actions.description).toContain(
        "An ongoing scope for noticing, tracking, documenting, learning, or understanding belongs in a Thread",
      );
      expect(prompt).not.toMatch(/Atlas|puppy/i);
      return { object: schema.parse({ ...modelResult, clean: fixtureRaw }) };
    });

    const response = await POST(new Request("http://localhost/api/sort", {
      method: "POST",
      body: JSON.stringify({ raw: fixtureRaw, threads: [] }),
    }));
    expect(response.status).toBe(200);
  },
);

it("teaches the finish-line test with an ongoing record and a bounded deliverable", async () => {
  const fixtureRaw = "The shaded beds stay cooler. I want to keep observing which spots help seedlings recover.";
  ai.generateObject.mockImplementation(async ({ schema, prompt }) => {
    expect(prompt).toContain("apply the completion test");
    expect(prompt).toContain("could the person mark it done");
    expect(prompt).toContain("Keeping an open-ended record defines what accumulates in the Thread");
    expect(prompt).toContain("These have stated one-time results and can be completed");
    expect(prompt).not.toMatch(/Atlas|puppy/i);
    return {
      object: schema.parse({
        ...modelResult,
        clean: fixtureRaw,
        kind: "thread",
        actions: [],
        primaryActions: [],
        threadId: null,
        threadName: "Field observations",
        primaryText: null,
      }),
    };
  });
  const response = await POST(new Request("http://localhost/api/sort", {
    method: "POST",
    body: JSON.stringify({ raw: fixtureRaw, threads: [] }),
  }));
  expect(response.status).toBe(200);
});

const mixedExistingNewThinkingFixtures = [
  {
    raw: "The harbor acoustics notes should compare foghorn echoes across the inlet. Separately, I want to develop a compact archive of hand-bound paper samples and how they age.",
    existing: { id: "harbor", name: "Harbor acoustics", about: "Sound observations around the harbor." },
    primaryText: "The harbor acoustics notes should compare foghorn echoes across the inlet.",
    newText: "I want to develop a compact archive of hand-bound paper samples and how they age.",
    newName: "Hand-bound paper archive",
  },
  {
    raw: "The fermentation notebook should track how cool proofing changes aroma. Another subject I want to shape is a meteor-sketch index organized by cloud cover and viewing angle.",
    existing: { id: "fermentation", name: "Fermentation notebook", about: "Bread fermentation observations." },
    primaryText: "The fermentation notebook should track how cool proofing changes aroma.",
    newText: "Another subject I want to shape is a meteor-sketch index organized by cloud cover and viewing angle.",
    newName: "Meteor sketch index",
  },
];

it.each(mixedExistingNewThinkingFixtures)(
  "keeps mixed existing-and-new developing thoughts representable as one legacy Thread result",
  async ({ raw: fixtureRaw, existing, primaryText, newText, newName }) => {
    ai.generateObject.mockImplementation(async ({ schema, prompt }) => {
      expect(prompt).toContain(fixtureRaw);
      expect(prompt).toContain(
        "Destination shape does not change semantic kind. If every independent claim is developing thought, set the top-level kind to thread",
      );
      expect(prompt).toContain(
        "Distinguish what the speaker wants an external subject or project to become from how the speaker chooses to live",
      );
      expect(schema.shape.kind.description).toContain(
        "one or more observations or inquiries",
      );
      return {
        object: schema.parse({
          ...modelResult,
          clean: fixtureRaw,
          kind: "thread",
          actions: [],
          primaryActions: [],
          threadId: existing.id,
          threadName: null,
          primaryText,
          also: [{ text: newText, threadId: null, threadName: newName }],
        }),
      };
    });

    const response = await POST(new Request("http://localhost/api/sort", {
      method: "POST",
      body: JSON.stringify({ raw: fixtureRaw, threads: [existing] }),
    }));
    expect(response.status).toBe(200);
    const output = await response.json();
    expect(output).toMatchObject({
      kind: "thread",
      actions: [],
      threadId: existing.id,
      threadName: null,
      primaryText,
      also: [{ text: newText, threadId: null, threadName: newName }],
    });
  },
);

const intentionBoundaryFixtures = [
  {
    label: "permission about growth",
    raw: "I give myself permission to learn in public before I feel fully prepared.",
  },
  {
    label: "chosen relational stance",
    raw: "I lead with patience when collaboration gets tense.",
  },
  {
    label: "self-directed resolve",
    raw: "I choose curiosity over defensiveness in difficult conversations.",
  },
  {
    label: "present-tense observation",
    raw: "I notice collaboration gets tense when decisions stay implicit.",
  },
  {
    label: "open inquiry",
    raw: "What makes me defensive in difficult conversations?",
  },
  {
    label: "concrete commitment",
    raw: "I will send Noor the workshop outline by Thursday.",
  },
];

it.each(intentionBoundaryFixtures)(
  "gives the provider a general declaration-versus-observation-versus-commitment contract for $label",
  async ({ raw: fixtureRaw }) => {
    let observedPrompt = "";
    let observedKindDescription = "";
    ai.generateObject.mockImplementation(async ({ schema, prompt }) => {
      observedPrompt = prompt;
      observedKindDescription = schema.shape.kind.description ?? "";
      return { object: schema.parse({ ...modelResult, clean: fixtureRaw }) };
    });

    const response = await POST(new Request("http://localhost/api/sort", {
      method: "POST",
      body: JSON.stringify({ raw: fixtureRaw, threads: [] }),
    }));
    expect(response.status).toBe(200);
    expect(observedPrompt).toContain(fixtureRaw);
    expect(observedPrompt).toContain(
      "A concise present-tense declaration can be an Intention without wish, hope, or future-tense language",
    );
    expect(observedPrompt).toContain(
      "values, permissions, personal stances, and self-directed resolves",
    );
    expect(observedPrompt).toContain(
      "reporting or questioning what is true is developing thought for a Thread",
    );
    expect(observedPrompt).toContain(
      "A concrete commitment with a source-stated finish line is an Action",
    );
    expect(observedPrompt).toContain(
      'For an Intention, set "actions" and "primaryActions" to [] and leave every Thread destination null',
    );
    expect(observedPrompt).toContain(
      "Do not treat a concise declaration as ambiguous merely because it is present tense",
    );
    expect(observedKindDescription).toContain("chosen way of being or living");
    expect(observedKindDescription).toContain("observation or inquiry");
    expect(observedKindDescription).toContain(
      "concrete commitment with a source-stated finish line",
    );
    expect(observedPrompt).not.toMatch(/\bearn\b|deliberate rest/i);
  },
);

it("runs the real route schema, reconciliation and filing without a provider call", async () => {
  ai.generateObject.mockImplementation(async ({ schema }) => ({ object: schema.parse(modelResult) }));
  const response = await POST(new Request("http://localhost/api/sort", { method: "POST", body: JSON.stringify({ raw, threads: [{ id: "pricing", name: "Annual pricing", about: thinking }] }) }));
  expect(response.status).toBe(200);
  const out = await response.json();
  const { next } = applySorted(out, [], 1000, { ...EMPTY, threads: [{ id: "pricing", name: "Annual pricing", summary: thinking, frags: [] }] });
  expect(next.actions.map(a => a.threadId)).toEqual([undefined, undefined]);
  expect(actionsForThread(next, next.threads[0]).open).toEqual([]);
  expect(next.threads[0].frags[0].text).toBe(thinking);
  expect(out.clean).toBe(raw);
});

it("does not carry selected action provenance into a different series-overridden home", async () => {
  ai.generateObject.mockImplementation(async ({ schema }) => ({ object: schema.parse({ ...modelResult, threadId: null, threadName: "Webhook reliability", primaryActions: [modelResult.actions[0]] }) }));
  const response = await POST(new Request("http://localhost/api/sort", { method: "POST", body: JSON.stringify({ raw, threads: [{ id: "pricing", name: "Annual pricing", about: thinking }], series: { threadId: "pricing", threadName: "Annual pricing", minutesAgo: 1 } }) }));
  const out = await response.json();
  expect(out.threadId).toBe("pricing");
  expect(out.primaryActions).toEqual([]);
});

it("schedules an inert Jev shadow with only the reconciled thinking decision", async () => {
  jev.scheduleJevThreadRerankShadow.mockClear();
  ai.generateObject.mockImplementation(async ({ schema }) => ({ object: schema.parse(modelResult) }));

  const response = await POST(new Request("http://localhost/api/sort", {
    method: "POST",
    body: JSON.stringify({
      raw,
      threads: [
        { id: "pricing", name: "Annual pricing", about: thinking },
        { id: "webhooks", name: "Webhook reliability", about: "Retry failures" },
      ],
    }),
  }));

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject(modelResult);
  expect(jev.scheduleJevThreadRerankShadow).toHaveBeenCalledWith({
    capture: thinking,
    candidates: [
      { id: "pricing", name: "Annual pricing", about: thinking },
      { id: "webhooks", name: "Webhook reliability", about: "Retry failures" },
    ],
    sorterThreadId: "pricing",
    sorterCreatedNewThread: false,
  }, { authorization: { mode: "non-cloud" } });
});

it("does not schedule Jev for an action result", async () => {
  jev.scheduleJevThreadRerankShadow.mockClear();
  ai.generateObject.mockImplementation(async ({ schema }) => ({
    object: schema.parse({
      ...modelResult,
      kind: "action",
      actions: ["Fix the Stripe webhook retry bug"],
      primaryActions: [],
      primaryText: null,
      threadId: null,
      threadName: null,
    }),
  }));

  const response = await POST(new Request("http://localhost/api/sort", {
    method: "POST",
    body: JSON.stringify({ raw, threads: [] }),
  }));

  expect(response.status).toBe(200);
  expect(jev.scheduleJevThreadRerankShadow).not.toHaveBeenCalled();
});

it.each([null, "", "   "])("skips Jev rather than leaking clean action text when primaryText is %j", async (primaryText) => {
  jev.scheduleJevThreadRerankShadow.mockClear();
  ai.generateObject.mockImplementation(async ({ schema }) => ({
    object: schema.parse({
      ...modelResult,
      kind: "both",
      actions: ["Fix the Stripe webhook retry bug"],
      primaryActions: [],
      primaryText,
      threadId: "pricing",
      threadName: null,
    }),
  }));

  const response = await POST(new Request("http://localhost/api/sort", {
    method: "POST",
    body: JSON.stringify({
      raw: thinking,
      threads: [{ id: "pricing", name: "Annual pricing", about: thinking }],
    }),
  }));

  expect(response.status).toBe(200);
  expect(jev.scheduleJevThreadRerankShadow).not.toHaveBeenCalled();
});

it("uses clean thinking for an unsplit thread whose primaryText is null", async () => {
  jev.scheduleJevThreadRerankShadow.mockClear();
  ai.generateObject.mockImplementation(async ({ schema }) => ({
    object: schema.parse({
      ...modelResult,
      clean: thinking,
      kind: "thread",
      actions: [],
      primaryActions: [],
      primaryText: null,
      threadId: "pricing",
      threadName: null,
    }),
  }));

  const response = await POST(new Request("http://localhost/api/sort", {
    method: "POST",
    body: JSON.stringify({
      raw: thinking,
      threads: [{ id: "pricing", name: "Annual pricing", about: thinking }],
    }),
  }));

  expect(response.status).toBe(200);
  expect(jev.scheduleJevThreadRerankShadow).toHaveBeenCalledWith(
    expect.objectContaining({ capture: thinking, sorterThreadId: "pricing" }),
    { authorization: { mode: "non-cloud" } },
  );
});

it("marks a missing existing id as the sorter's new-thread abstention when thinking is isolated", async () => {
  jev.scheduleJevThreadRerankShadow.mockClear();
  ai.generateObject.mockImplementation(async ({ schema }) => ({
    object: schema.parse({
      ...modelResult,
      kind: "thread",
      actions: [],
      primaryActions: [],
      primaryText: thinking,
      threadId: null,
      threadName: "Pricing decision",
    }),
  }));

  const response = await POST(new Request("http://localhost/api/sort", {
    method: "POST",
    body: JSON.stringify({
      raw: thinking,
      threads: [{ id: "pricing", name: "Annual pricing", about: thinking }],
    }),
  }));

  expect(response.status).toBe(200);
  expect(jev.scheduleJevThreadRerankShadow).toHaveBeenCalledWith(
    expect.objectContaining({
      capture: thinking,
      sorterThreadId: null,
      sorterCreatedNewThread: true,
    }),
    { authorization: { mode: "non-cloud" } },
  );
});
