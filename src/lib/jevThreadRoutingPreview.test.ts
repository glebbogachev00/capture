import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  buildJevThreadRoutingPreviewRequest,
  isJevThreadRoutingPreviewEnabled,
  routeThinkingWithJevPreview,
  type JevThinkingShare,
  type JevThreadCandidate,
} from "./jevThreadRerank";

const candidates: JevThreadCandidate[] = [
  {
    id: "exact-private-product-id",
    name: "Capture product",
    about: "Product direction, semantic sorting, and keeping rough thoughts.",
  },
  {
    id: "exact-private-garden-id",
    name: "Back garden",
    about: "Planting layout, raised beds, and seasonal maintenance.",
  },
];

const enabledEnv = {
  VERCEL_ENV: "preview",
  CAPTURE_JEV_THREAD_ROUTING_PREVIEW: "1",
  OPENROUTER_API_KEY: "synthetic-key",
};

type RequestedCandidate = { label: string; name: string; about: string };
type RequestedShare = { label: string; text: string };
type Choice = number | "new";

function decisionsResponse(init: RequestInit | undefined, choices: Choice[]): Response {
  const body = JSON.parse(String(init?.body)) as {
    state: {
      thinkingShares: RequestedShare[];
      candidateThreads: RequestedCandidate[];
    };
    questions: Record<string, { criteria: Record<string, string> }>;
  };
  const questionEntries = Object.entries(body.questions);
  expect(questionEntries).toHaveLength(choices.length);
  expect(body.state.thinkingShares).toHaveLength(choices.length);

  const candidateLabels = body.state.candidateThreads.map((candidate) => candidate.label);
  const answers = Object.fromEntries(questionEntries.map(([question, value], shareIndex) => {
    const options = Object.keys(value.criteria);
    const newOption = options.find((option) => !candidateLabels.includes(option));
    expect(newOption).toBeDefined();
    const requested = choices[shareIndex];
    const choice = requested === "new" ? newOption! : candidateLabels[requested];
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
}

function fetchChoosing(...choices: Choice[]) {
  return vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
    decisionsResponse(init, choices));
}

function thinking(overrides: Partial<JevThinkingShare> = {}): JevThinkingShare {
  return {
    text: "Capture should keep related product thinking together.",
    threadId: null,
    threadName: "Capture product",
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Preview-only Jev thread routing", () => {
  it("reuses an obvious existing durable subject", async () => {
    const shares = [thinking()];
    const fetcher = fetchChoosing(0);
    const onOutcome = vi.fn();

    const routed = await routeThinkingWithJevPreview(
      { thinking: shares, candidates },
      { env: enabledEnv, fetcher, onOutcome },
    );

    expect(fetcher).toHaveBeenCalledOnce();
    expect(onOutcome).toHaveBeenCalledWith("applied");
    expect(routed).toEqual([{
      ...shares[0],
      threadId: "exact-private-product-id",
      threadName: null,
    }]);
  });

  it("keeps an unrelated shared-word match as a new Thread", async () => {
    const shares = [thinking({
      text: "The Capture article needs a first-person opening and a stronger ending.",
      threadId: "exact-private-product-id",
      threadName: "Capture launch article",
    })];

    const routed = await routeThinkingWithJevPreview(
      { thinking: shares, candidates },
      { env: enabledEnv, fetcher: fetchChoosing("new") },
    );

    expect(routed).toEqual([{
      ...shares[0],
      threadId: null,
      threadName: "Capture launch article",
    }]);
  });

  it("keeps a distinct deliverable as a new Thread", async () => {
    const shares = [thinking({
      text: "I am developing a workshop about Capture and outlining its exercises.",
      threadId: "exact-private-product-id",
      threadName: "Capture workshop",
    })];

    const routed = await routeThinkingWithJevPreview(
      { thinking: shares, candidates },
      { env: enabledEnv, fetcher: fetchChoosing("new") },
    );

    expect(routed).toEqual([{
      ...shares[0],
      threadId: null,
      threadName: "Capture workshop",
    }]);
  });

  it("routes every thinking share independently in one Decisions call", async () => {
    const shares = [
      thinking(),
      thinking({
        text: "The workshop needs a hands-on exercise about recovering rough ideas.",
        threadId: "exact-private-product-id",
        threadName: "Capture workshop",
      }),
      thinking({
        text: "The shaded bed should use plants that tolerate wet soil.",
        threadId: null,
        threadName: "Back garden",
      }),
    ];
    const fetcher = fetchChoosing(0, "new", 1);

    const routed = await routeThinkingWithJevPreview(
      { thinking: shares, candidates },
      { env: enabledEnv, fetcher },
    );

    expect(fetcher).toHaveBeenCalledOnce();
    const sent = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(Object.keys(sent.questions)).toHaveLength(3);
    expect(Object.values(sent.questions).every((question) =>
      (question as { type: string }).type === "choice")).toBe(true);
    expect(routed.map((share) => [share.threadId, share.threadName])).toEqual([
      ["exact-private-product-id", null],
      [null, "Capture workshop"],
      ["exact-private-garden-id", null],
    ]);
  });

  it("falls back to the interpreter's exact routes for malformed, non-maximal, quota, and timed-out responses", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const shares = [thinking({
      threadId: "exact-private-product-id",
      threadName: "Interpreter-owned name",
    })];
    const malformedFetchers = [
      vi.fn(async () => Response.json({
        answers: {},
        model: "typesafe/jev-1.13",
        usage: { input_tokens: 1, output_tokens: 1 },
      })),
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const good = await decisionsResponse(init, [0]).json() as {
          answers: Record<string, {
            choice: string;
            probabilities: Record<string, number>;
          }>;
          model: string;
          provider: string;
          usage: object;
        };
        const answer = Object.values(good.answers)[0];
        const alternatives = Object.keys(answer.probabilities).filter((option) => option !== answer.choice);
        answer.probabilities[answer.choice] = 0.1;
        answer.probabilities[alternatives[0]] = 0.9;
        return Response.json(good);
      }),
      vi.fn(async () => new Response(null, { status: 429 })),
    ];

    for (const fetcher of malformedFetchers) {
      const onOutcome = vi.fn();
      const routed = await routeThinkingWithJevPreview(
        { thinking: shares, candidates },
        { env: enabledEnv, fetcher, onOutcome },
      );
      expect(routed).toBe(shares);
      expect(onOutcome).toHaveBeenCalledWith("fallback");
    }

    vi.useFakeTimers();
    const never = vi.fn(() => new Promise<Response>(() => {}));
    const deadline = new AbortController();
    const pending = routeThinkingWithJevPreview(
      { thinking: shares, candidates },
      { env: enabledEnv, fetcher: never, signal: deadline.signal },
    );
    let settled = false;
    void pending.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(124);
    expect(settled).toBe(false);
    deadline.abort(new DOMException("shared route deadline", "TimeoutError"));
    await expect(pending).resolves.toBe(shares);
    expect(info).not.toHaveBeenCalled();
  });

  it.each([
    ["flag off", { ...enabledEnv, CAPTURE_JEV_THREAD_ROUTING_PREVIEW: "0" }, [thinking()], candidates],
    ["not Preview", { ...enabledEnv, VERCEL_ENV: "production" }, [thinking()], candidates],
    ["missing key", { ...enabledEnv, OPENROUTER_API_KEY: undefined }, [thinking()], candidates],
    ["no candidates", enabledEnv, [thinking()], []],
    ["no thinking", enabledEnv, [], candidates],
    ["candidate inventory above the explicit bound", enabledEnv, [thinking()], Array.from({ length: 41 }, (_, index) => ({
      id: `private-${index}`,
      name: `Candidate ${index}`,
      about: "Bounded synthetic metadata.",
    }))],
  ] as const)("makes no Decisions call when %s", async (_label, env, shares, threadCandidates) => {
    const fetcher = vi.fn();
    const routed = await routeThinkingWithJevPreview(
      {
        thinking: shares as unknown as JevThinkingShare[],
        candidates: threadCandidates as unknown as JevThreadCandidate[],
      },
      { env, fetcher },
    );

    expect(routed).toBe(shares);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("requires the dedicated flag, the Preview environment, and the key", () => {
    expect(isJevThreadRoutingPreviewEnabled(enabledEnv)).toBe(true);
    expect(isJevThreadRoutingPreviewEnabled({ ...enabledEnv, VERCEL_ENV: "production" })).toBe(false);
    expect(isJevThreadRoutingPreviewEnabled({ ...enabledEnv, CAPTURE_JEV_THREAD_ROUTING_PREVIEW: "0" })).toBe(false);
    expect(isJevThreadRoutingPreviewEnabled({ ...enabledEnv, OPENROUTER_API_KEY: undefined })).toBe(false);
  });

  it("uses fresh opaque labels and omits exact thread IDs from the bounded request", () => {
    const first = buildJevThreadRoutingPreviewRequest({
      thinking: [thinking(), thinking({ text: "A second independent share." })],
      candidates: candidates.map((candidate) => ({
        ...candidate,
        name: candidate.name.repeat(100),
        about: candidate.about.repeat(100),
      })),
    });
    const second = buildJevThreadRoutingPreviewRequest({
      thinking: [thinking(), thinking({ text: "A second independent share." })],
      candidates,
    });
    const serialized = JSON.stringify(first);

    expect(serialized).not.toContain("exact-private-product-id");
    expect(serialized).not.toContain("exact-private-garden-id");
    expect(first.state.thinkingShares.every((share) => share.text.length <= 2_000)).toBe(true);
    expect(first.state.candidateThreads.every((candidate) =>
      candidate.name.length <= 120 && candidate.about.length <= 700)).toBe(true);
    expect(Object.keys(first.questions)).toHaveLength(2);
    expect(Object.keys(first.questions)).not.toEqual(Object.keys(second.questions));
    const optionLabels = first.state.candidateThreads.map((candidate) => candidate.label);
    expect(optionLabels.every((label) => !serialized.includes(`private-${label}`))).toBe(true);
  });
});
