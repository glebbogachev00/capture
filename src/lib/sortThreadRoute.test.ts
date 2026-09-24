import { NoObjectGeneratedError } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applySorted } from "./boardOps";
import { EMPTY, hydrate } from "./model";
import { recordSortedCapture } from "./settle";
import { BRIEF_BUDGET, threadBriefs } from "./threadBrief";

const ai = vi.hoisted(() => ({ generateObject: vi.fn(), generateText: vi.fn() }));
const jev = vi.hoisted(() => ({ scheduleJevThreadRerankShadow: vi.fn() }));
const providers = vi.hoisted(() => ({ fallback: vi.fn() }));
const cloud = vi.hoisted(() => ({ mode: "non-cloud" as "non-cloud" | "cloud", released: vi.fn() }));

vi.mock("ai", async (importOriginal) => ({
  ...await importOriginal<typeof import("ai")>(),
  ...ai,
}));
vi.mock("@/lib/jevThreadRerank", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./jevThreadRerank")>();
  return { ...actual, scheduleJevThreadRerankShadow: jev.scheduleJevThreadRerankShadow };
});
vi.mock("@/lib/clientIp", () => ({ clientIp: () => "synthetic" }));
vi.mock("@/lib/limiter", () => ({ modelRateLimit: () => ({ allowed: true }) }));
vi.mock("@/lib/routing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./routing")>();
  return {
    ...actual,
    // Route behavior is tested with synthetic providers here. Exact
    // production provider/model qualification has its own routing.test.ts.
    supportsSemanticSort: (tier: { name: string }) => tier.name !== "cerebras",
  };
});
vi.mock("@/lib/cloudRequestGuard.server", () => ({
  authorizeManagedAiRequest: async () => cloud.mode === "cloud"
    ? { mode: "cloud", admissionId: "sort-test" }
    : { mode: "non-cloud" },
  withManagedAiAdmission: async (authorization: { mode: string }, work: () => Promise<unknown>) => {
    try { return await work(); }
    finally { if (authorization.mode === "cloud") cloud.released(); }
  },
}));
vi.mock("@/lib/providers", () => ({
  NoProvidersError: class extends Error {},
  sanitizeProviderError: () => "synthetic provider rejection",
  visionChain: () => [{ name: "vision", modelId: "mock-vision", model: "mock-vision", providerOptions: {} }],
  withFallback: providers.fallback,
}));

providers.fallback.mockImplementation(async (call: (tier: object) => Promise<unknown>) => ({
    value: await call({ name: "gemini", modelId: "gemini-3.6-flash", model: "mock-text-provider" }),
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
  sourceSegments?: {
    text: string;
    role: "thinking" | "action" | "intention" | "context";
    ownerIndex: number | null;
    actionOwnerIndexes?: number[] | null;
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

function malformedStructuredOutput(text = "not valid structured output") {
  return new NoObjectGeneratedError({
    message: "No object generated: response did not match schema.",
    text,
    response: { id: "synthetic", modelId: "synthetic", timestamp: new Date(0) },
    usage: {
      inputTokens: undefined,
      inputTokenDetails: {
        noCacheTokens: undefined,
        cacheReadTokens: undefined,
        cacheWriteTokens: undefined,
      },
      outputTokens: undefined,
      outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
      totalTokens: undefined,
    },
    finishReason: "stop",
  });
}

function actionInterpretation(source: string): Interpretation {
  return {
    clean: source,
    title: "Call the dentist",
    thinking: [],
    actions: [{
      text: "Call the dentist",
      sourceText: source,
      thinkingIndex: null,
      shelfLife: "days",
      due: null,
    }],
    intention: null,
    shelfLife: "days",
    due: null,
  };
}

function providerValue(value: Interpretation) {
  const semantic = [
    ...value.thinking.map((share, ownerIndex) => ({ text: share.text, role: "thinking" as const, ownerIndex })),
    ...value.actions.map((action, ownerIndex) => ({ text: action.sourceText, role: "action" as const, ownerIndex })),
    ...(value.intention ? [{ text: value.intention, role: "intention" as const, ownerIndex: 0 }] : []),
  ].map((segment) => ({ ...segment, start: value.clean.indexOf(segment.text) }))
    .filter((segment) => segment.start >= 0)
    .sort((left, right) => left.start - right.start);
  const sourceSegments: NonNullable<Interpretation["sourceSegments"]> = value.sourceSegments
    ? value.sourceSegments
    : [];
  let cursor = 0;
  if (!value.sourceSegments) {
    for (const segment of semantic) {
      const gap = value.clean.slice(cursor, segment.start);
      if (gap) sourceSegments.push({ text: gap, role: "context", ownerIndex: null });
      sourceSegments.push({ text: segment.text, role: segment.role, ownerIndex: segment.ownerIndex });
      cursor = segment.start + segment.text.length;
    }
    const tail = value.clean.slice(cursor);
    if (tail) sourceSegments.push({ text: tail, role: "context", ownerIndex: null });
  }

  let thinkingIndex = 0;
  let actionIndex = 0;
  return {
    title: value.title,
    segments: sourceSegments.map((segment) => {
      if (segment.role === "context") {
        const owners = segment.actionOwnerIndexes ?? [];
        const first = owners.length ? value.actions[owners[0]] : null;
        return {
          role: "context" as const,
          source: segment.text,
          threadId: null,
          threadName: null,
          ownsImage: null,
          action: null,
          thinkingOrdinal: null,
          intention: null,
          actionOrdinals: owners.length ? owners.map((index) => index + 1) : null,
          shelfLife: first?.shelfLife ?? null,
          due: first?.due ?? null,
        };
      }
      if (segment.role === "thinking") {
        const share = value.thinking[thinkingIndex];
        const index = thinkingIndex;
        thinkingIndex += 1;
        return {
          role: "thinking" as const,
          source: segment.text,
          threadId: share.threadId,
          threadName: share.threadName,
          ownsImage: (value.imageThinkingIndex ?? null) === index,
          action: null,
          thinkingOrdinal: null,
          intention: null,
          actionOrdinals: null,
          shelfLife: null,
          due: null,
        };
      }
      if (segment.role === "action") {
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
      }
      return {
        role: "intention" as const,
        source: segment.text,
        threadId: null,
        threadName: null,
        ownsImage: null,
        action: null,
        thinkingOrdinal: null,
        intention: value.intention!,
        actionOrdinals: null,
        shelfLife: null,
        due: null,
      };
    }),
  };
}

function answer(value: Interpretation) {
  ai.generateObject.mockImplementation(async ({ schema }) => ({
    object: schema.parse(providerValue(value)),
  }));
}

type JevChoice = number | "new";

function enablePreviewJev(...choices: JevChoice[]) {
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("CAPTURE_JEV_THREAD_ROUTING_PREVIEW", "1");
  vi.stubEnv("OPENROUTER_API_KEY", "synthetic-key");
  const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as {
      state: { candidateThreads: { label: string }[] };
      questions: Record<string, { criteria: Record<string, string> }>;
    };
    const candidateLabels = body.state.candidateThreads.map((candidate) => candidate.label);
    const answers = Object.fromEntries(Object.entries(body.questions).map(([question, value], index) => {
      const options = Object.keys(value.criteria);
      const newOption = options.find((option) => !candidateLabels.includes(option))!;
      const requested = choices[index];
      const choice = requested === "new" ? newOption : candidateLabels[requested];
      return [question, {
        type: "choice",
        choice,
        confidence: 1,
        probabilities: Object.fromEntries(options.map((option) => [option, option === choice ? 1 : 0])),
      }];
    }));
    return Response.json({
      answers,
      model: "typesafe/jev-1.13-20260917",
      provider: "TypeSafe",
      usage: { input_tokens: 200, output_tokens: 20 },
    });
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

beforeEach(() => {
  ai.generateObject.mockReset();
  ai.generateText.mockReset();
  providers.fallback.mockClear();
  jev.scheduleJevThreadRerankShadow.mockReset();
  cloud.mode = "non-cloud";
  cloud.released.mockReset();
  vi.stubEnv("VERCEL_ENV", "test");
  vi.stubEnv("CAPTURE_JEV_THREAD_ROUTING_PREVIEW", "0");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("the semantic sorter route", () => {
  it("hard-bounds a stalled body reader at the route deadline and releases Cloud admission", async () => {
    vi.useFakeTimers();
    cloud.mode = "cloud";
    const pending = POST(Object.assign(new Request("http://localhost/api/sort", { method: "POST" }), {
      json: () => new Promise<never>(() => {}),
    }));

    await vi.advanceTimersByTimeAsync(55_000);

    await expect(pending).resolves.toMatchObject({ status: 400 });
    expect(cloud.released).toHaveBeenCalledOnce();
  });

  it("hard-bounds a stalled vision provider at the route deadline and releases Cloud admission", async () => {
    vi.useFakeTimers();
    cloud.mode = "cloud";
    ai.generateText.mockReturnValue(new Promise(() => {}));
    const pending = POST(request({
      raw: "Keep this image.",
      threads: [],
      imgs: ["data:image/png;base64,AA=="],
    }));

    await vi.advanceTimersByTimeAsync(55_000);

    await expect(pending).resolves.toMatchObject({ status: 502 });
    expect(cloud.released).toHaveBeenCalledOnce();
  });

  it("cancels a provider attempt even when the provider promise ignores abort", async () => {
    let attemptSignal: AbortSignal | undefined;
    ai.generateObject.mockImplementation(({ abortSignal }) => {
      attemptSignal = abortSignal;
      return new Promise(() => {});
    });

    const abort = new AbortController();
    const pending = POST(new Request("http://localhost/api/sort", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        raw: "A thought that cannot be stranded.",
        threads: [],
        localDate: "2026-09-24",
        timeZone: "Asia/Bangkok",
      }),
      signal: abort.signal,
    }));
    await vi.waitFor(() => expect(ai.generateObject).toHaveBeenCalledTimes(1));
    abort.abort(new DOMException("test cancellation", "AbortError"));
    await expect(pending).resolves.toMatchObject({ status: 502 });

    expect(attemptSignal?.aborted).toBe(true);
    expect(ai.generateObject).toHaveBeenCalledOnce();
  });

  it("retries one malformed structured response on the same provider, then succeeds", async () => {
    const source = "Call the dentist.";
    const valid = providerValue(actionInterpretation(source));
    const privateProviderText = "PRIVATE PROVIDER OUTPUT";
    ai.generateObject
      .mockRejectedValueOnce(malformedStructuredOutput(privateProviderText))
      .mockImplementationOnce(async ({ schema }) => ({ object: schema.parse(valid) }));

    const response = await POST(request({ raw: source, threads: [] }));
    const out = await response.json();

    expect(response.status).toBe(200);
    expect(ai.generateObject).toHaveBeenCalledTimes(2);
    expect(ai.generateObject.mock.calls.map(([options]) => options.model))
      .toEqual(["mock-text-provider", "mock-text-provider"]);
    expect(out).toMatchObject({
      kind: "action",
      via: "mock-no-provider",
    });
    expect(JSON.stringify(out)).not.toContain(privateProviderText);
  });

  it("falls through only after two malformed responses from the same provider", async () => {
    const source = "Call the dentist.";
    const valid = providerValue(actionInterpretation(source));
    providers.fallback.mockImplementationOnce(async (call: (tier: object) => Promise<unknown>) => {
      try {
        await call({ name: "gemini", modelId: "gemini-3.6-flash", model: "gemini-model" });
        throw new Error("expected the first provider to fail");
      } catch (error) {
        if (!(error instanceof NoObjectGeneratedError)) throw error;
      }
      return {
        value: await call({ name: "groq", modelId: "openai/gpt-oss-120b", model: "groq-model" }),
        via: "groq",
        preferred: "gemini",
        fallback: true,
        fallbackReason: "provider_failure",
      };
    });
    ai.generateObject.mockImplementation(async ({ model, schema }) => {
      if (model === "gemini-model") throw malformedStructuredOutput();
      return { object: schema.parse(valid) };
    });

    const response = await POST(request({ raw: source, threads: [] }));
    const out = await response.json();

    expect(response.status).toBe(200);
    expect(ai.generateObject.mock.calls.map(([options]) => options.model))
      .toEqual(["gemini-model", "gemini-model", "groq-model"]);
    expect(out).toMatchObject({
      via: "groq",
      routing: {
        fallback: true,
        fallbackReason: "provider_failure",
      },
    });
  });

  it.each([402, 429])("does not same-provider retry a fatal provider status %s", async (statusCode) => {
    const source = "Call the dentist.";
    const valid = providerValue(actionInterpretation(source));
    providers.fallback.mockImplementationOnce(async (call: (tier: object) => Promise<unknown>) => {
      try {
        await call({ name: "gemini", modelId: "gemini-3.6-flash", model: "gemini-model" });
        throw new Error("expected the first provider to fail");
      } catch (error) {
        expect(error).toMatchObject({ statusCode });
      }
      return {
        value: await call({ name: "groq", modelId: "openai/gpt-oss-120b", model: "groq-model" }),
        via: "groq",
        preferred: "gemini",
        fallback: true,
        fallbackReason: statusCode === 429 ? "rate_limit" : "provider_failure",
      };
    });
    ai.generateObject.mockImplementation(async ({ model, schema }) => {
      if (model === "gemini-model") {
        throw Object.assign(new Error("fatal provider refusal"), { statusCode });
      }
      return { object: schema.parse(valid) };
    });

    const response = await POST(request({ raw: source, threads: [] }));
    const out = await response.json();

    expect(response.status).toBe(200);
    expect(ai.generateObject.mock.calls.map(([options]) => options.model))
      .toEqual(["gemini-model", "groq-model"]);
    expect(out.routing).toMatchObject({
      fallback: true,
      fallbackReason: statusCode === 429 ? "rate_limit" : "provider_failure",
    });
  });

  it("does not let a malformed-output retry outlive the shared route deadline", async () => {
    vi.useFakeTimers();
    const source = "Call the dentist.";
    providers.fallback.mockImplementationOnce(async (call: (tier: object) => Promise<unknown>) => {
      await new Promise((resolve) => setTimeout(resolve, 54_500));
      return {
        value: await call({ name: "gemini", modelId: "gemini-3.6-flash", model: "gemini-model" }),
        via: "gemini",
        preferred: "gemini",
        fallback: false,
        fallbackReason: null,
      };
    });
    ai.generateObject
      .mockRejectedValueOnce(malformedStructuredOutput())
      .mockImplementationOnce(() => new Promise(() => {}));

    const pending = POST(request({ raw: source, threads: [] }));
    await vi.advanceTimersByTimeAsync(54_500);
    expect(ai.generateObject).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(500);

    await expect(pending).resolves.toMatchObject({ status: 502 });
    expect(ai.generateObject).toHaveBeenCalledTimes(2);
  });

  it("leaves a successful first interpretation unchanged", async () => {
    const source = "Call the dentist.";
    answer(actionInterpretation(source));

    const response = await POST(request({ raw: source, threads: [] }));
    const out = await response.json();

    expect(response.status).toBe(200);
    expect(ai.generateObject).toHaveBeenCalledOnce();
    expect(out).toMatchObject({
      kind: "action",
      actions: ["Call the dentist"],
      via: "mock-no-provider",
    });
  });

  it("rejects an unqualified fallback result and accepts only a verified semantic Sort provider", async () => {
    const source = "Call the dentist tomorrow.";
    answer({
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
    });
    providers.fallback.mockImplementationOnce(async (call: (tier: object) => Promise<unknown>) => {
      await expect(call({ name: "cerebras", modelId: "gpt-oss-120b", model: "unqualified" })).rejects.toMatchObject({
        statusCode: 422,
      });
      return {
        value: await call({ name: "gemini", modelId: "gemini-3.6-flash", model: "verified" }),
        via: "gemini",
        preferred: "gemini",
        fallback: true,
        fallbackReason: "rate_limit",
      };
    });

    const response = await POST(request({ raw: source, threads: [] }));

    expect(response.status).toBe(200);
    expect(ai.generateObject).toHaveBeenCalledTimes(1);
    expect((await response.json()).via).toBe("gemini");
  });

  it("accepts the legacy nested client calendar context while clients migrate to flat fields", async () => {
    const source = "Call the dentist tomorrow.";
    ai.generateObject.mockImplementation(async ({ schema, prompt }) => {
      expect(prompt).toContain("client local date 2026-09-23 in timezone Asia/Ho_Chi_Minh");
      return {
        object: schema.parse(providerValue({
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
          sourceSegments: [{ text: source, role: "action", ownerIndex: 0, actionOwnerIndexes: null }],
          intention: null,
          imageThinkingIndex: null,
          shelfLife: "days",
          due: "2026-09-24",
        })),
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

  it.each([
    ["missing", {}],
    ["malformed", { localDate: "not-a-date", timeZone: "Mars/Olympus" }],
    ["impossible", { localDate: "2026-02-30", timeZone: "Asia/Bangkok" }],
  ])("uses a safe bounded calendar fallback for %s stale-client fields", async (_label, calendar) => {
    const source = "Call the dentist.";
    ai.generateObject.mockImplementation(async ({ schema, prompt }) => {
      expect(prompt).toMatch(/client local date \d{4}-\d{2}-\d{2} in timezone UTC/u);
      expect(prompt).not.toContain("Today is");
      return {
        object: schema.parse(providerValue({
          clean: source,
          title: "Call the dentist",
          thinking: [],
          actions: [{
            text: "Call the dentist",
            sourceText: source,
            thinkingIndex: null,
            shelfLife: "days",
            due: null,
          }],
          sourceSegments: [{ text: source, role: "action", ownerIndex: 0, actionOwnerIndexes: null }],
          intention: null,
          imageThinkingIndex: null,
          shelfLife: "days",
          due: null,
        })),
      };
    });

    const response = await POST(new Request("http://localhost/api/sort", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ raw: source, threads: [], ...calendar }),
    }));

    expect(response.status).toBe(200);
    expect((await response.json()).kind).toBe("action");
  });

  it.each(["action", "intention"] as const)(
    "ignores an irrelevant hallucinated thread route when %s is authoritative",
    async (force) => {
      const source = force === "action"
        ? "Send the final draft."
        : "I protect two quiet hours every morning.";
      answer({
        clean: source,
        title: force === "action" ? "Send final draft" : "Quiet mornings",
        thinking: [{ text: source, threadId: "guessed-route", threadName: null }],
        actions: force === "action" ? [{
          text: "Send the final draft",
          sourceText: source,
          thinkingIndex: null,
          shelfLife: "days",
          due: null,
        }] : [],
        intention: force === "intention" ? source : null,
        shelfLife: force === "action" ? "days" : "keep",
        due: null,
      });

      const response = await POST(request({
        raw: source,
        force,
        threads: threadBriefs([{ id: "real-thread", name: "Real thread", summary: "", frags: [] }]),
      }));

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ kind: force });
    },
  );

  it("uses only the current flat client-local calendar in the provider prompt", async () => {
    const source = "Call the dentist before Friday.";
    ai.generateObject.mockImplementation(async ({ schema, prompt }) => {
      expect(prompt).toContain("client local date 2026-09-24 in timezone Asia/Bangkok");
      expect(prompt).not.toContain("Today is");
      return {
        object: schema.parse(providerValue({
          clean: source,
          title: "Call the dentist",
          thinking: [],
          actions: [{
            text: "Call the dentist",
            sourceText: source,
            thinkingIndex: null,
            shelfLife: "days",
            due: "2026-09-25",
          }],
          sourceSegments: [{ text: source, role: "action", ownerIndex: 0, actionOwnerIndexes: null }],
          intention: null,
          imageThinkingIndex: null,
          shelfLife: "days",
          due: "2026-09-25",
        })),
      };
    });

    const response = await POST(new Request("http://localhost/api/sort", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        raw: source,
        threads: [],
        localDate: "2026-09-24",
        timeZone: "Asia/Bangkok",
      }),
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ kind: "action", due: "2026-09-25" });
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

    ai.generateObject.mockImplementation(async ({ schema }) => ({
      object: schema.parse({
        title: "One",
        segments: Array.from({ length: 13 }, (_, index) => ({
          role: "thinking",
          source: index === 0 ? "One." : "x",
          threadId: null,
          threadName: `Thread ${index}`,
          ownsImage: false,
          action: null,
          thinkingOrdinal: null,
          intention: null,
          actionOrdinals: null,
          shelfLife: null,
          due: null,
        })),
      }),
    }));
    const oversizedProvider = await POST(request({ raw: "One.", threads: [] }));
    expect(oversizedProvider.status).toBe(422);
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

  it("lets Preview Jev reuse an obvious existing Thread without changing interpreted content", async () => {
    const source = "Capture should keep related product thinking together.";
    answer({
      clean: source,
      title: "Capture product direction",
      thinking: [{ text: source, threadId: null, threadName: "Capture product" }],
      actions: [], intention: null, shelfLife: "keep", due: null,
    });
    const fetcher = enablePreviewJev(0);

    const response = await POST(request({
      raw: source,
      threads: [{ id: "product", name: "Capture product", about: "Semantic sorting and rough thoughts." }],
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      clean: source,
      kind: "thread",
      threadId: "product",
      threadName: null,
    });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(ai.generateObject).toHaveBeenCalledOnce();
  });

  it("lets Preview Jev reject an unrelated shared-word trap as a new Thread", async () => {
    const source = "The rainwater capture barrel needs a leaf filter and a safer overflow path.";
    answer({
      clean: source,
      title: "Rainwater capture system",
      thinking: [{ text: source, threadId: "r0", threadName: "Rainwater capture system" }],
      actions: [], intention: null, shelfLife: "keep", due: null,
    });
    enablePreviewJev("new");

    const response = await POST(request({
      raw: source,
      threads: [{ id: "product", name: "Capture product", about: "The Capture app and semantic sorting." }],
    }));

    expect(await response.json()).toMatchObject({
      clean: source,
      threadId: null,
      threadName: "Rainwater capture system",
    });
  });

  it("lets Preview Jev keep a distinct authored deliverable as a new Thread", async () => {
    const source = "I am developing a workshop about Capture and outlining its exercises.";
    answer({
      clean: source,
      title: "Capture workshop",
      thinking: [{ text: source, threadId: "r0", threadName: "Capture workshop" }],
      actions: [], intention: null, shelfLife: "keep", due: null,
    });
    enablePreviewJev("new");

    const response = await POST(request({
      raw: source,
      threads: [{ id: "product", name: "Capture product", about: "The app's product direction." }],
    }));

    expect(await response.json()).toMatchObject({
      clean: source,
      threadId: null,
      threadName: "Capture workshop",
    });
  });

  it("applies independent Preview Jev destinations for all shares from one request", async () => {
    const first = "Capture should preserve rough product thinking.";
    const second = "The workshop needs a hands-on recovery exercise.";
    const third = "The shaded garden bed should use plants that tolerate wet soil.";
    const source = `${first} ${second} ${third}`;
    answer({
      clean: source,
      title: "Product workshop and garden",
      thinking: [
        { text: first, threadId: null, threadName: "Capture product" },
        { text: second, threadId: "r0", threadName: "Capture workshop" },
        { text: third, threadId: null, threadName: "Back garden" },
      ],
      actions: [], intention: null, shelfLife: "keep", due: null,
    });
    const fetcher = enablePreviewJev(0, "new", 1);

    const response = await POST(request({
      raw: source,
      threads: [
        { id: "product", name: "Capture product", about: "Product direction and semantic sorting." },
        { id: "garden", name: "Back garden", about: "Planting layout and seasonal maintenance." },
      ],
    }));
    const out = await response.json();

    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(out.clean.replace(/\s+/gu, " ")).toBe(source);
    expect(out).toMatchObject({
      threadId: "product",
      primaryText: first,
      also: [
        { text: second, threadId: null, threadName: "Capture workshop" },
        { text: third, threadId: "garden", threadName: null },
      ],
    });
  });

  it("preserves the interpreter's exact routing when the Preview Decisions response is malformed", async () => {
    const source = "Capture should preserve rough thoughts.";
    answer({
      clean: source,
      title: "Capture rough thoughts",
      thinking: [{ text: source, threadId: "r0", threadName: "Interpreter name" }],
      actions: [], intention: null, shelfLife: "keep", due: null,
    });
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("CAPTURE_JEV_THREAD_ROUTING_PREVIEW", "1");
    vi.stubEnv("OPENROUTER_API_KEY", "synthetic-key");
    const fetcher = vi.fn(async () => Response.json({
      answers: {},
      model: "typesafe/jev-1.13",
      usage: { input_tokens: 1, output_tokens: 1 },
    }));
    vi.stubGlobal("fetch", fetcher);

    const response = await POST(request({
      raw: source,
      threads: [{ id: "product", name: "Capture product", about: "Rough thoughts." }],
    }));

    expect(await response.json()).toMatchObject({ threadId: "product", threadName: null });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("falls back at the exact shared route deadline when Decisions ignores abort", async () => {
    vi.useFakeTimers();
    cloud.mode = "cloud";
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("CAPTURE_JEV_THREAD_ROUTING_PREVIEW", "1");
    vi.stubEnv("OPENROUTER_API_KEY", "synthetic-key");
    const source = "Capture should preserve rough thoughts.";
    const interpreted = providerValue({
      clean: source,
      title: "Capture rough thoughts",
      thinking: [{ text: source, threadId: "r0", threadName: "Capture rough thoughts" }],
      actions: [], intention: null, shelfLife: "keep", due: null,
    });
    providers.fallback.mockImplementationOnce(() => new Promise((resolve) => {
      setTimeout(() => resolve({
        value: interpreted,
        via: "gemini",
        preferred: "gemini",
        fallback: false,
        fallbackReason: null,
      }), 54_500);
    }));
    const fetcher = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal("fetch", fetcher);

    let settled = false;
    const pending = POST(request({
      raw: source,
      threads: [{ id: "product", name: "Capture product", about: "Rough thoughts." }],
    })).then((response) => {
      settled = true;
      return response;
    });

    await vi.advanceTimersByTimeAsync(54_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const response = await pending;
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ threadId: "product", threadName: null });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(cloud.released).toHaveBeenCalledOnce();
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

  it("parks a capture when the provider returns context without a semantic item", async () => {
    ai.generateObject.mockImplementation(async ({ schema }) => ({
      object: schema.parse({
        title: "Two subjects",
        segments: [{
          role: "context",
          source: "First subject. Second subject.",
          threadId: null,
          threadName: null,
          ownsImage: null,
          action: null,
          thinkingOrdinal: null,
          intention: null,
          actionOrdinals: null,
          shelfLife: null,
          due: null,
        }],
      }),
    }));
    const response = await POST(request({ raw: "First subject. Second subject.", threads: [] }));
    expect(response.status).toBe(422);
    expect(ai.generateObject).toHaveBeenCalledOnce();
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
    const response = await POST(request({
      raw,
      threads: [{ id: "pricing", name: "Annual pricing", about: thinking }],
      force,
    }));
    expect(response.status).toBe(200);
    expect((await response.json()).kind).toBe(kind);
  });

  it("returns a coordinated action list with explicit shared context and exact source provenance", async () => {
    const source = "Before Friday, audit the onboarding flow, rewrite the empty-state copy, ask Nina to review the privacy wording, and schedule the release email.";
    answer({
      clean: source,
      title: "Friday launch tasks",
      thinking: [],
      actions: [
        { text: "Audit the onboarding flow", sourceText: "audit the onboarding flow", thinkingIndex: null, shelfLife: "days", due: "2026-09-27" },
        { text: "Rewrite the empty-state copy", sourceText: "rewrite the empty-state copy", thinkingIndex: null, shelfLife: "days", due: "2026-09-27" },
        { text: "Ask Nina to review the privacy wording", sourceText: "ask Nina to review the privacy wording", thinkingIndex: null, shelfLife: "days", due: "2026-09-27" },
        { text: "Schedule the release email", sourceText: "schedule the release email", thinkingIndex: null, shelfLife: "days", due: "2026-09-27" },
      ],
      sourceSegments: [
        { text: "Before Friday, ", role: "context", ownerIndex: null, actionOwnerIndexes: [0, 1, 2, 3] },
        { text: "audit the onboarding flow", role: "action", ownerIndex: 0 },
        { text: ", ", role: "context", ownerIndex: null },
        { text: "rewrite the empty-state copy", role: "action", ownerIndex: 1 },
        { text: ", ", role: "context", ownerIndex: null },
        { text: "ask Nina to review the privacy wording", role: "action", ownerIndex: 2 },
        { text: ", and ", role: "context", ownerIndex: null },
        { text: "schedule the release email", role: "action", ownerIndex: 3 },
        { text: ".", role: "context", ownerIndex: null },
      ],
      intention: null,
      shelfLife: "days",
      due: null,
    });

    const response = await POST(request({ raw: source, threads: [] }));
    const out = await response.json();

    expect(response.status).toBe(200);
    expect(out.clean.replace(/\s+/gu, " ")).toBe(source);
    expect(out).toMatchObject({ kind: "action", threadId: null, threadName: null, due: null });
    expect(out.actions).toEqual([
      "Audit the onboarding flow",
      "Rewrite the empty-state copy",
      "Ask Nina to review the privacy wording",
      "Schedule the release email",
    ]);
    expect(out.actionMeta.map((action: { source: string }) => action.source)).toEqual([
      "audit the onboarding flow",
      "rewrite the empty-state copy",
      "ask Nina to review the privacy wording",
      "schedule the release email",
    ]);
    expect(out.actionMeta.every((action: { due: string | null }) => action.due === "2026-09-25")).toBe(true);
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
        object: schema.parse(providerValue({
          clean: "The long-form collection could connect health, work, and identity.",
          title: "Long-form collection",
          thinking: [{
            text: "The long-form collection could connect health, work, and identity.",
            threadId: "r0",
            threadName: null,
          }],
          actions: [],
          sourceSegments: [{
            text: "The long-form collection could connect health, work, and identity.",
            role: "thinking",
            ownerIndex: 0,
            actionOwnerIndexes: null,
          }],
          intention: null,
          imageThinkingIndex: null,
          shelfLife: "keep",
          due: null,
        })),
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