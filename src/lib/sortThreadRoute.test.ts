import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applySorted } from "./boardOps";
import { EMPTY, hydrate } from "./model";
import { recordSortedCapture } from "./settle";
import { BRIEF_BUDGET, threadBriefs } from "./threadBrief";

const ai = vi.hoisted(() => ({ generateObject: vi.fn(), generateText: vi.fn() }));
const jev = vi.hoisted(() => ({ scheduleJevThreadRerankShadow: vi.fn() }));
const providers = vi.hoisted(() => ({ fallback: vi.fn() }));

vi.mock("ai", () => ai);
vi.mock("@/lib/jevThreadRerank", () => jev);
vi.mock("@/lib/clientIp", () => ({ clientIp: () => "synthetic" }));
vi.mock("@/lib/limiter", () => ({ modelRateLimit: () => ({ allowed: true }) }));
vi.mock("@/lib/providers", () => ({
  NoProvidersError: class extends Error {},
  sanitizeProviderError: () => "synthetic provider rejection",
  visionChain: () => [{ name: "vision", model: "mock-vision", providerOptions: {} }],
  withFallback: providers.fallback,
}));

providers.fallback.mockImplementation(async (call: (tier: object) => Promise<unknown>) => ({
    value: await call({ model: "mock-text-provider" }),
    via: "mock-no-provider",
    preferred: "mock-primary",
    fallback: false,
  }));

import { POST } from "@/app/api/sort/route";

type Interpretation = {
  clean: string;
  title: string;
  thinking: { text: string; threadId: string | null; threadName: string | null }[];
  actions: {
    text: string;
    sourceText: string;
    thinkingIndex: number | null;
    shelfLife: "hours" | "days" | "weeks" | "keep";
    due: string | null;
  }[];
  intention: string | null;
  imageThinkingIndex?: number | null;
  shelfLife: "hours" | "days" | "weeks" | "keep";
  due: string | null;
};

const thinking = "I am debating annual pricing versus monthly pricing.";
const raw = `Fix the Stripe webhook retry bug. ${thinking} Call mom this weekend.`;
const mixed: Interpretation = {
  clean: raw,
  title: "Pricing and errands",
  thinking: [{ text: thinking, threadId: "r0", threadName: null }],
  actions: [
    { text: "Fix the Stripe webhook retry bug", sourceText: "Fix the Stripe webhook retry bug.", thinkingIndex: 0, shelfLife: "keep", due: null },
    { text: "Call mom this weekend", sourceText: "Call mom this weekend.", thinkingIndex: null, shelfLife: "days", due: null },
  ],
  intention: null,
  shelfLife: "keep",
  due: null,
};

const request = (body: object) => new Request("http://localhost/api/sort", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ localDate: "2026-09-23", timeZone: "Asia/Ho_Chi_Minh", ...body }),
});

function answer(value: Interpretation) {
  ai.generateObject.mockImplementation(async ({ schema }) => ({
    object: schema.parse(value),
  }));
}

beforeEach(() => {
  ai.generateObject.mockReset();
  ai.generateText.mockReset();
  providers.fallback.mockClear();
  jev.scheduleJevThreadRerankShadow.mockReset();
});

afterEach(() => vi.restoreAllMocks());

describe("the single-pass semantic sorter", () => {
  it("accepts the legacy nested client calendar context while clients migrate to flat fields", async () => {
    const source = "Call the dentist tomorrow.";
    ai.generateObject.mockImplementation(async ({ schema, prompt }) => {
      expect(prompt).toContain("client local date 2026-09-23 in timezone Asia/Ho_Chi_Minh");
      return {
        object: schema.parse({
          clean: source,
          title: "Call the dentist",
          thinking: [],
          actions: [{
            text: "Call the dentist",
            sourceText: source,
            thinkingIndex: null,
            shelfLife: "days",
            due: "2026-09-24",
          }],
          intention: null,
          shelfLife: "days",
          due: "2026-09-24",
        }),
      };
    });
    const response = await POST(new Request("http://localhost/api/sort", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        raw: source,
        threads: [],
        clientDate: {
          localDate: "2026-09-23",
          timeZone: "Asia/Ho_Chi_Minh",
        },
      }),
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      kind: "action",
      due: "2026-09-24",
    });
  });

  it("derives a mixed filing and relates only the action that advances its thinking", async () => {
    answer(mixed);
    const response = await POST(request({
      raw,
      threads: [{ id: "pricing", name: "Annual pricing", about: thinking }],
    }));

    expect(response.status).toBe(200);
    expect(ai.generateObject).toHaveBeenCalledTimes(1);
    const out = await response.json();
    expect(out).toMatchObject({
      kind: "both",
      threadId: "pricing",
      primaryText: thinking,
      actions: ["Fix the Stripe webhook retry bug", "Call mom this weekend"],
      primaryActions: ["Fix the Stripe webhook retry bug"],
    });

    const board = {
      ...EMPTY,
      threads: [{ id: "pricing", name: "Annual pricing", summary: thinking, frags: [] }],
    };
    const { next } = applySorted(out, [], 1_000, board);
    expect(next.actions.map((action) => action.threadId)).toEqual(["pricing", undefined]);
    expect(next.threads[0].frags[0].text).toBe(thinking);
  });

  it("routes several independent thinking subjects in the same response", async () => {
    answer({
      clean: "Capture should preserve rough thoughts. The launch article needs a sharper angle.",
      title: "Capture and launch article",
      thinking: [
        { text: "Capture should preserve rough thoughts.", threadId: "r0", threadName: null },
        { text: "The launch article needs a sharper angle.", threadId: null, threadName: "Capture launch article" },
      ],
      actions: [],
      intention: null,
      shelfLife: "keep",
      due: null,
    });

    const response = await POST(request({
      raw: "Capture should preserve rough thoughts. The launch article needs a sharper angle.",
      threads: [{ id: "product", name: "Capture product", about: "Preserving rough thoughts" }],
    }));
    expect(ai.generateObject).toHaveBeenCalledTimes(1);
    expect(await response.json()).toMatchObject({
      kind: "thread",
      threadId: "product",
      primaryText: "Capture should preserve rough thoughts.",
      also: [{
        text: "The launch article needs a sharper angle.",
        threadId: null,
        threadName: "Capture launch article",
      }],
    });
  });

  it("reuses an existing product thread through the one semantic call", async () => {
    answer({
      clean: "Capture should answer questions from a person's notes.",
      title: "Answers from notes",
      thinking: [{
        text: "Capture should answer questions from a person's notes.",
        threadId: "r0",
        threadName: null,
      }],
      actions: [],
      intention: null,
      shelfLife: "keep",
      due: null,
    });

    const response = await POST(request({
      raw: "Capture should answer questions from a person's notes.",
      threads: [{ id: "product", name: "Capture product", about: "How Capture preserves rough thoughts" }],
    }));
    expect(await response.json()).toMatchObject({ threadId: "product", threadName: null });
    expect(ai.generateObject).toHaveBeenCalledTimes(1);
  });

  it("reuses a relevant thread beyond the old first-24 window without creating a duplicate", async () => {
    const threads = Array.from({ length: 32 }, (_, index) => ({
      id: `thread-${index}`,
      name: index === 31 ? "Long-horizon orchard design" : `Distinct project ${index}`,
      summary: index === 31 ? "Decisions about the orchard layout and planting seasons." : `Boundary ${index}`,
      frags: [{ id: `frag-${index}`, at: index, text: `Settled source for project ${index}.` }],
    }));
    const source = "The orchard layout needs another row for late-summer planting.";
    answer({
      clean: source,
      title: "Orchard layout",
      thinking: [{ text: source, threadId: "rv", threadName: null }],
      actions: [],
      intention: null,
      shelfLife: "keep",
      due: null,
    });

    const candidates = threadBriefs(threads);
    const response = await POST(request({ raw: source, threads: candidates }));
    const out = await response.json();
    const applied = applySorted(out, [], 1_000, { ...EMPTY, threads });

    expect(candidates).toHaveLength(32);
    expect(out).toMatchObject({ threadId: "thread-31", threadName: null });
    expect(applied.next.threads).toHaveLength(32);
    expect(applied.next.threads.find((thread) => thread.id === "thread-31")?.frags.at(-1)?.text)
      .toBe(source);
    expect(ai.generateObject).toHaveBeenCalledTimes(1);
  });

  it("maps a late opaque selection back to the exact long thread id without duplicate minting", async () => {
    const threads = Array.from({ length: 120 }, (_, index) => ({
      id: `imported-${index}-${"i".repeat(300)}`,
      name: `${index === 119 ? "Late orchard" : `Distinct ${index}`} ${"n".repeat(220)}`,
      summary: index === 119 ? "Late orchard planting decisions." : `Unrelated boundary ${index}.`,
      frags: [{ id: `frag-${index}`, at: index, text: `Settled source ${index}.` }],
    }));
    const source = "The late orchard needs a winter planting row.";
    answer({
      clean: source,
      title: "Late orchard row",
      thinking: [{ text: source, threadId: "r3b", threadName: null }],
      actions: [], intention: null, shelfLife: "keep", due: null,
    });

    const candidates = threadBriefs(threads);
    const response = await POST(request({ raw: source, threads: candidates }));
    const out = await response.json();
    const applied = applySorted(out, [], 1_000, { ...EMPTY, threads });
    const routePrompt = ai.generateObject.mock.calls[0][0].prompt as string;

    expect(response.status).toBe(200);
    expect(out.threadId).toBe(threads[119].id);
    expect(applied.next.threads).toHaveLength(120);
    expect(applied.next.threads.find((thread) => thread.id === threads[119].id)?.frags.at(-1)?.text)
      .toBe(source);
    const inventory = routePrompt.match(/CANDIDATE THREADS\n([^\n]+)/)?.[1] ?? "";
    expect(inventory.length).toBeLessThanOrEqual(BRIEF_BUDGET);
    expect(inventory).not.toContain(threads[119].id);
  });

  it("fails closed on a malformed opaque selection instead of minting a duplicate by name", async () => {
    const source = "The late orchard needs another row.";
    answer({
      clean: source,
      title: "Late orchard",
      thinking: [{ text: source, threadId: "rzz", threadName: "Late orchard" }],
      actions: [], intention: null, shelfLife: "keep", due: null,
    });
    const response = await POST(request({
      raw: source,
      threads: threadBriefs([{ id: "exact-orchard", name: "Late orchard", summary: "", frags: [] }]),
    }));
    expect(response.status).toBe(422);
  });

  it("caps request values and provider decomposition at the route schema boundary", async () => {
    const oversizedRequest = await POST(request({
      raw: "x".repeat(20_001),
      threads: [],
    }));
    expect(oversizedRequest.status).toBe(400);
    expect(ai.generateObject).not.toHaveBeenCalled();

    answer({
      clean: "One.", title: "One",
      thinking: Array.from({ length: 13 }, (_, index) => ({
        text: index === 0 ? "One." : "x",
        threadId: null,
        threadName: `Thread ${index}`,
      })),
      actions: [], intention: null, shelfLife: "keep", due: null,
    });
    const oversizedProvider = await POST(request({ raw: "One.", threads: [] }));
    expect(oversizedProvider.status).toBe(502);
  });

  it("keeps a distinct deliverable separate without a second routing pass", async () => {
    answer({
      clean: "I am writing an article about Capture and working out its argument.",
      title: "Capture launch article",
      thinking: [{
        text: "I am writing an article about Capture and working out its argument.",
        threadId: null,
        threadName: "Capture launch article",
      }],
      actions: [],
      intention: null,
      shelfLife: "keep",
      due: null,
    });

    const response = await POST(request({
      raw: "I am writing an article about Capture and working out its argument.",
      threads: [{ id: "product", name: "Capture product", about: "How Capture handles thoughts" }],
    }));
    expect(await response.json()).toMatchObject({
      threadId: null,
      threadName: "Capture launch article",
    });
    expect(ai.generateObject).toHaveBeenCalledTimes(1);
  });

  it("uses complete clean thinking for an unsplit new thread and marks the Jev route as new", async () => {
    const source = "The pricing decision still needs more thought.";
    answer({
      clean: source,
      title: "Pricing decision",
      thinking: [{ text: source, threadId: null, threadName: "Pricing decision" }],
      actions: [],
      intention: null,
      shelfLife: "keep",
      due: null,
    });

    const response = await POST(request({ raw: source, threads: [] }));
    const out = await response.json();
    expect(out).toMatchObject({
      kind: "thread",
      clean: source,
      primaryText: null,
      threadId: null,
      threadName: "Pricing decision",
    });
    expect(jev.scheduleJevThreadRerankShadow).toHaveBeenCalledWith(
      expect.objectContaining({
        capture: source,
        sorterThreadId: null,
        sorterCreatedNewThread: true,
      }),
      expect.any(Object),
    );
  });

  it("treats series continuity as evidence rather than a deterministic override", async () => {
    answer({
      clean: "The launch article needs a clearer opening.",
      title: "Launch article opening",
      thinking: [{
        text: "The launch article needs a clearer opening.",
        threadId: null,
        threadName: "Capture launch article",
      }],
      actions: [],
      intention: null,
      shelfLife: "keep",
      due: null,
    });

    const response = await POST(request({
      raw: "The launch article needs a clearer opening.",
      threads: [{ id: "product", name: "Capture product", about: "Product direction" }],
      series: { threadId: "product", threadName: "Capture product", minutesAgo: 1 },
    }));
    expect(await response.json()).toMatchObject({
      threadId: null,
      threadName: "Capture launch article",
    });
  });

  it("rejects a schema-valid lossy decomposition so the client can keep it pending", async () => {
    answer({
      clean: "First subject. Second subject.",
      title: "Two subjects",
      thinking: [{ text: "First subject.", threadId: null, threadName: "First" }],
      actions: [],
      intention: null,
      shelfLife: "keep",
      due: null,
    });
    const response = await POST(request({ raw: "First subject. Second subject.", threads: [] }));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: expect.stringMatching(/safely separate/i) });
    expect(jev.scheduleJevThreadRerankShadow).not.toHaveBeenCalled();
  });

  it("fails closed on a model-invented candidate route", async () => {
    answer({
      clean: thinking,
      title: "Pricing decision",
      thinking: [{ text: thinking, threadId: "r404", threadName: "Pricing decision" }],
      actions: [],
      intention: null,
      shelfLife: "keep",
      due: null,
    });

    const response = await POST(request({
      raw: thinking,
      threads: [{ id: "pricing", name: "Annual pricing", about: thinking }],
    }));
    expect(response.status).toBe(422);
  });

  it.each([
    ["thread", "thread"],
    ["action", "action"],
    ["intention", "intention"],
  ] as const)("makes an explicit force=%s choice authoritative", async (force, kind) => {
    answer(mixed);
    const response = await POST(request({ raw, threads: [], force }));
    expect(response.status).toBe(200);
    expect((await response.json()).kind).toBe(kind);
  });

  it("clears a shared deadline when several actions were interpreted", async () => {
    answer({
      clean: "Call the dentist and buy milk by Friday.",
      title: "Dentist and milk",
      thinking: [],
      actions: [
        { text: "Call the dentist", sourceText: "Call the dentist", thinkingIndex: null, shelfLife: "days", due: null },
        { text: "Buy milk", sourceText: "and buy milk by Friday.", thinkingIndex: null, shelfLife: "days", due: "2026-09-25" },
      ],
      intention: null,
      shelfLife: "days",
      due: "2026-09-25",
    });
    const response = await POST(request({ raw: "Call the dentist and buy milk by Friday.", threads: [] }));
    expect(await response.json()).toMatchObject({ kind: "action", due: null });
  });

  it("gives semantic corrections to the same model call without applying phrase overrides", async () => {
    ai.generateObject.mockImplementation(async ({ schema, prompt }) => {
      expect(prompt).toContain("CORRECTION EXAMPLES");
      expect(prompt).toContain("I want to develop a book from several essays");
      expect(prompt).toContain('"chosenKind":"thread"');
      expect(prompt).not.toContain("Reference examples");
      expect(prompt).not.toContain("one narrow routing question");
      return {
        object: schema.parse({
          clean: "The long-form collection could connect health, work, and identity.",
          title: "Long-form collection",
          thinking: [{
            text: "The long-form collection could connect health, work, and identity.",
            threadId: "r0",
            threadName: null,
          }],
          actions: [],
          intention: null,
          shelfLife: "keep",
          due: null,
        }),
      };
    });

    const response = await POST(request({
      raw: "The long-form collection could connect health, work, and identity.",
      threads: [{ id: "book", name: "Book project", about: "A book assembled from essays" }],
      corrections: [{
        capture: "I want to develop a book from several essays.",
        chosenKind: "thread",
        chosenThreadId: "book",
        chosenThreadName: "Book project",
      }],
      rules: ['Captures about "long form" are an action'],
    }));

    expect(await response.json()).toMatchObject({ kind: "thread", threadId: "book" });
    expect(ai.generateObject).toHaveBeenCalledTimes(1);
  });

  it("schedules the Jev shadow only with reconciled thinking", async () => {
    answer(mixed);
    await POST(request({
      raw,
      threads: [{ id: "pricing", name: "Annual pricing", about: thinking }],
    }));

    expect(jev.scheduleJevThreadRerankShadow).toHaveBeenCalledWith(
      expect.objectContaining({
        capture: thinking,
        sorterThreadId: "pricing",
        sorterCreatedNewThread: false,
      }),
      expect.objectContaining({
        authorization: expect.objectContaining({ mode: "non-cloud" }),
      }),
    );
  });

  it("does not let never-settling Jev scheduling delay the sort response", async () => {
    jev.scheduleJevThreadRerankShadow.mockReturnValue(new Promise(() => {}));
    answer({
      clean: thinking,
      title: "Pricing decision",
      thinking: [{ text: thinking, threadId: "r0", threadName: null }],
      actions: [],
      intention: null,
      shelfLife: "keep",
      due: null,
    });
    const response = await POST(request({
      raw: thinking,
      threads: [{ id: "pricing", name: "Annual pricing", about: thinking }],
    }));
    expect(response.status).toBe(200);
  });

  it("does not schedule the Jev shadow for an action", async () => {
    answer({
      clean: "Call the dentist.",
      title: "Call the dentist",
      thinking: [],
      actions: [{ text: "Call the dentist", sourceText: "Call the dentist.", thinkingIndex: null, shelfLife: "days", due: null }],
      intention: null,
      shelfLife: "days",
      due: null,
    });
    await POST(request({ raw: "Call the dentist.", threads: [] }));
    expect(jev.scheduleJevThreadRerankShadow).not.toHaveBeenCalled();
  });

  it("keeps an action-only capture image on its owning shot fragment through application and persistence", async () => {
    ai.generateText.mockResolvedValue({ text: "A receipt photo." });
    answer({
      clean: "Save the receipt.",
      title: "Save the receipt",
      thinking: [],
      actions: [{
        text: "Save the receipt",
        sourceText: "Save the receipt.",
        thinkingIndex: null,
        shelfLife: "days",
        due: null,
      }],
      intention: null,
      imageThinkingIndex: null,
      shelfLife: "days",
      due: null,
    });

    const response = await POST(request({
      raw: "Save the receipt.",
      threads: [],
      imgs: ["data:image/png;base64,AA=="],
    }));
    const out = await response.json();
    expect(out).toMatchObject({ kind: "action", primaryOwnsImages: true });

    const applied = applySorted(out, ["receipt-image"], 1_000, EMPTY);
    const action = applied.next.actions[0];
    expect(action.shot).toBeDefined();
    const owner = applied.next.threads.find((thread) => thread.id === action.shot?.threadId)
      ?.frags.find((frag) => frag.id === action.shot?.fragId);
    expect(owner?.imgs).toEqual(["receipt-image"]);

    let ledgerId = 0;
    const recorded = recordSortedCapture(applied.next, {
      raw: "Save the receipt.",
      payload: "Save the receipt.",
      at: 1_000,
      dictated: false,
      imgIds: ["receipt-image"],
      captureId: "capture-with-image",
      kind: out.kind,
      clean: out.clean,
      primaryOwnsImages: out.primaryOwnsImages,
      primary: { targetId: action.id },
      summaryThreadIds: applied.targetId ? [applied.targetId] : [],
      also: [],
    }, () => `ledger-${++ledgerId}`).board;
    const persisted = hydrate(JSON.parse(JSON.stringify(recorded)));
    const persistedAction = persisted.actions.find((item) => item.id === action.id)!;
    const persistedOwner = persisted.threads.find((thread) => thread.id === persistedAction.shot?.threadId)
      ?.frags.find((frag) => frag.id === persistedAction.shot?.fragId);
    expect(persistedOwner?.imgs).toEqual(["receipt-image"]);
    expect(persisted.ledger.find((entry) => entry.captureId === "capture-with-image")?.imgs)
      .toEqual(["receipt-image"]);
  });

  it("captions only through the bounded vision chain, never the general text fallback", async () => {
    ai.generateText.mockResolvedValue({ text: "A Retake screenshot." });
    answer({
      clean: "Photo: A Retake screenshot.",
      title: "Retake screenshot",
      thinking: [{ text: "Photo: A Retake screenshot.", threadId: null, threadName: "Retake" }],
      actions: [],
      intention: null,
      imageThinkingIndex: 0,
      shelfLife: "keep",
      due: null,
    });
    const response = await POST(request({
      raw: "(image only)",
      threads: [],
      imgs: ["data:image/png;base64,AA=="],
    }));
    expect(response.status).toBe(200);
    expect(ai.generateText).toHaveBeenCalledOnce();
    expect(ai.generateText.mock.calls[0][0]).toEqual(expect.objectContaining({
      model: "mock-vision",
      maxRetries: 0,
      abortSignal: expect.any(AbortSignal),
    }));
    expect(providers.fallback).toHaveBeenCalledTimes(1);
    expect(ai.generateObject.mock.calls[0][0].model).toBe("mock-text-provider");
  });
});