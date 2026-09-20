import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  JEV_RECALL_MODEL,
  buildJevRecallRequest,
  isJevRecallShadowEnabled,
  runJevRecallShadow,
  scheduleJevRecallShadow,
} from "./jevRecallShadow";

const sources = [
  {
    id: "structured-source-id-0",
    kind: "thread" as const,
    title: "Structured source title zero",
    text: "Prose identifier NOTE-17 has title Launch Plan, date 2026-09-18, state active, navigation /launch, account ACCT-42, and session SESSION-77.",
    at: 1_700_000_000_000,
    targetId: "structured-target-id-0",
    fragId: "structured-fragment-id-0",
    state: "active" as const,
    truncated: false,
  },
  {
    id: "structured-source-id-1",
    kind: "action" as const,
    title: "Structured source title one",
    text: "Book the launch review for the final week of September.",
    at: 1_700_000_000_001,
    targetId: "structured-target-id-1",
    state: "active" as const,
    truncated: false,
  },
];

const authoritativeAnswer = {
  status: "answered" as const,
  claims: [{
    text: "The launch is planned for October.",
    citations: [{ sourceId: sources[0].id, quote: "We decided to launch in October" }],
  }],
};

const input = {
  question: "Did account Q-ACCT-9 open session Q-SESSION-9 for title Question Plan on date 2026-09-19 in state pending via navigation /question?",
  sources,
  authoritativeAnswer,
};

const successPayload = () => ({
  answers: {
    query_intent: {
      type: "choice",
      choice: "answer_fact",
      confidence: 0.84,
      probabilities: {
        find_notes: 0.04,
        answer_fact: 0.84,
        synthesize: 0.1,
        unclear: 0.02,
      },
    },
    best_source: {
      type: "choice",
      choice: "source_1",
      confidence: 0.6,
      probabilities: { source_0: 0.25, source_1: 0.6, none: 0.15 },
    },
    evidence_sufficient: { type: "noul", noul: 0.72 },
  },
  model: "typesafe/jev-1.13-20260917",
  provider: "TypeSafe",
  usage: { input_tokens: 140, output_tokens: 14, cost: 0.000006 },
});

const successResponse = () => Response.json(successPayload());

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Jev Recall/Search decision request", () => {
  it("combines decisions, omits structured source fields, and preserves bounded prose without redaction", () => {
    const request = buildJevRecallRequest({
      ...input,
      question: `  ${input.question} ${"q".repeat(900)}  `,
      sources: sources.map((source) => ({ ...source, text: `  ${source.text.repeat(100)}  ` })),
    });

    expect(request.model).toBe(JEV_RECALL_MODEL);
    expect(Object.keys(request.questions)).toEqual([
      "query_intent",
      "best_source",
      "evidence_sufficient",
    ]);
    expect(request.questions.query_intent.type).toBe("choice");
    expect(request.questions.best_source.type).toBe("choice");
    expect(request.questions.evidence_sufficient.type).toBe("noul");
    expect(Object.keys(request.questions.best_source.criteria)).toEqual([
      "source_0",
      "source_1",
      "none",
    ]);
    expect(request.state.question.length).toBeLessThanOrEqual(500);
    expect(request.state.question).toContain("account Q-ACCT-9");
    expect(request.state.question).toContain("session Q-SESSION-9");
    expect(Object.keys(request.state.sources)).toEqual(["source_0", "source_1"]);
    expect(request.state.sources.source_0.excerpt.length).toBeLessThanOrEqual(1_000);
    expect(Object.keys(request)).toEqual(["model", "state", "questions"]);
    expect(Object.keys(request.state)).toEqual(["question", "sources"]);
    expect(Object.values(request.state.sources).every((source) =>
      Object.keys(source).length === 1 && "excerpt" in source
    )).toBe(true);

    const serialized = JSON.stringify(request);
    for (const proseValue of [
      "identifier NOTE-17",
      "title Launch Plan",
      "date 2026-09-18",
      "state active",
      "navigation /launch",
      "account ACCT-42",
      "session SESSION-77",
    ]) {
      expect(serialized).toContain(proseValue);
    }
  });

  it("maps a strict complete response deterministically without producing prose or citations", async () => {
    const fetcher = vi.fn(async () => successResponse());

    const result = await runJevRecallShadow(input, {
      apiKey: "synthetic-key",
      fetcher,
    });

    expect(fetcher).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      intent: "answer_fact",
      intentConfidence: 0.84,
      rankedSources: [
        { kind: "source", sourceIndex: 1, probability: 0.6 },
        { kind: "source", sourceIndex: 0, probability: 0.25 },
        { kind: "none", probability: 0.15 },
      ],
      sufficiency: 0.72,
    });
    expect(JSON.stringify(result)).not.toMatch(/claims|citations|reason|prose/i);
  });

  it("accepts exact maximum-probability ties and uses label order for source ranking", async () => {
    const payload = successPayload();
    payload.answers.query_intent.choice = "find_notes";
    payload.answers.query_intent.confidence = 0.45;
    payload.answers.query_intent.probabilities = {
      find_notes: 0.45,
      answer_fact: 0.45,
      synthesize: 0.08,
      unclear: 0.02,
    };
    payload.answers.best_source.choice = "source_0";
    payload.answers.best_source.confidence = 0.4;
    payload.answers.best_source.probabilities = { source_0: 0.4, source_1: 0.4, none: 0.2 };

    const result = await runJevRecallShadow(input, {
      apiKey: "synthetic-key",
      fetcher: async () => Response.json(payload),
    });

    expect(result.intent).toBe("find_notes");
    expect(result.rankedSources.map((rank) => rank.kind === "source" ? rank.sourceIndex : "none"))
      .toEqual([0, 1, "none"]);
  });

  const invalidResponses: [string, () => unknown][] = [
    ["missing answer", () => {
      const payload = successPayload();
      return {
        ...payload,
        answers: {
          query_intent: payload.answers.query_intent,
          best_source: payload.answers.best_source,
        },
      };
    }],
    ["unknown source label", () => {
      const payload = successPayload();
      return {
        ...payload,
        answers: {
          ...payload.answers,
          best_source: {
            ...payload.answers.best_source,
            probabilities: { source_0: 0.25, source_1: 0.5, source_9: 0.1, none: 0.15 },
          },
        },
      };
    }],
    ["missing none", () => {
      const payload = successPayload();
      return {
        ...payload,
        answers: {
          ...payload.answers,
          best_source: {
            ...payload.answers.best_source,
            probabilities: { source_0: 0.3, source_1: 0.7 },
          },
        },
      };
    }],
    ["invalid probability sum", () => {
      const payload = successPayload();
      return {
        ...payload,
        answers: {
          ...payload.answers,
          query_intent: {
            ...payload.answers.query_intent,
            probabilities: {
              ...payload.answers.query_intent.probabilities,
              answer_fact: 0.5,
            },
          },
        },
      };
    }],
    ["intent choice below the maximum probability", () => {
      const payload = successPayload();
      return {
        ...payload,
        answers: {
          ...payload.answers,
          query_intent: {
            ...payload.answers.query_intent,
            choice: "find_notes",
          },
        },
      };
    }],
    ["best-source choice below the maximum probability", () => {
      const payload = successPayload();
      return {
        ...payload,
        answers: {
          ...payload.answers,
          best_source: {
            ...payload.answers.best_source,
            choice: "source_0",
          },
        },
      };
    }],
    ["prose field", () => {
      const payload = successPayload();
      return {
        ...payload,
        answers: {
          ...payload.answers,
          evidence_sufficient: {
            ...payload.answers.evidence_sufficient,
            reason: "private generated prose",
          },
        },
      };
    }],
  ];

  it.each(invalidResponses)("rejects %s instead of guessing or accepting prose", async (_name, makePayload) => {
    await expect(runJevRecallShadow(input, {
      apiKey: "synthetic-key",
      fetcher: async () => Response.json(makePayload()),
    })).rejects.toMatchObject({ code: "invalid_response" });
  });
});

describe("Jev Recall shadow gate and containment", () => {
  it("is disabled unless its separate Recall flag and the key are both present", () => {
    expect(isJevRecallShadowEnabled({})).toBe(false);
    expect(isJevRecallShadowEnabled({
      OPENROUTER_API_KEY: "synthetic-key",
      CAPTURE_JEV_THREAD_RERANK_SHADOW: "1",
      CAPTURE_JEV_JUDGE_SHADOW: "1",
    })).toBe(false);
    expect(isJevRecallShadowEnabled({
      OPENROUTER_API_KEY: "synthetic-key",
      CAPTURE_JEV_RECALL_SHADOW: "0",
    })).toBe(false);
    expect(isJevRecallShadowEnabled({
      OPENROUTER_API_KEY: "synthetic-key",
      CAPTURE_JEV_RECALL_SHADOW: "1",
    })).toBe(true);
  });

  it("does not schedule or touch the network while disabled", () => {
    const schedule = vi.fn();
    const fetcher = vi.fn();

    expect(scheduleJevRecallShadow(input, { env: {}, schedule, fetcher })).toBe(false);
    expect(schedule).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("logs aggregate comparison/calibration fields only", async () => {
    let task: (() => void | Promise<void>) | undefined;
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const fetcher = vi.fn(async () => successResponse());

    expect(scheduleJevRecallShadow(input, {
      env: {
        OPENROUTER_API_KEY: "synthetic-key",
        CAPTURE_JEV_RECALL_SHADOW: "1",
      },
      schedule: (callback) => { task = callback; },
      fetcher,
    })).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
    await expect(Promise.resolve(task?.())).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledOnce();

    expect(info).toHaveBeenCalledWith("[capture] jev recall shadow", {
      authoritativeStatus: "answered",
      bestCitedSourceRank: 2,
      citedSourceCount: 1,
      inputTokens: 140,
      intent: "answer_fact",
      intentConfidenceBucket: 8,
      potentialAvoidedProseCallByIntent: false,
      sourceCount: 2,
      sufficiencyBucket: 7,
      topSource: "source",
      topSourceCited: false,
      topSourceIndex: 1,
    });
    const logged = JSON.stringify(info.mock.calls);
    expect(logged).not.toContain(input.question);
    expect(logged).not.toContain(sources[0].text);
    expect(logged).not.toContain(sources[0].id);
    expect(logged).not.toContain(sources[0].targetId);
    expect(logged).not.toContain(authoritativeAnswer.claims[0].text);
    expect(logged).not.toContain("synthetic-key");
  });

  it.each([
    ["malformed", async () => Response.json({ answers: {}, model: "bad", usage: {} })],
    ["privacy refusal", async () => new Response("private provider error", { status: 503 })],
    ["timeout", async () => { throw new DOMException("timed out", "TimeoutError"); }],
  ])("contains %s without changing the authoritative Recall result", async (_name, fetcher) => {
    let task: (() => void | Promise<void>) | undefined;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const before = structuredClone(input);

    expect(scheduleJevRecallShadow(input, {
      env: {
        OPENROUTER_API_KEY: "synthetic-key",
        CAPTURE_JEV_RECALL_SHADOW: "1",
      },
      schedule: (callback) => { task = callback; },
      fetcher,
    })).toBe(true);
    await expect(Promise.resolve(task?.())).resolves.toBeUndefined();

    expect(input).toEqual(before);
    expect(warn).toHaveBeenCalledWith(
      "[capture] jev recall shadow failed",
      expect.objectContaining({ name: "OpenRouterDecisionsError" })
    );
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).not.toContain(input.question);
    expect(logged).not.toContain(sources[0].text);
    expect(logged).not.toContain(sources[0].id);
  });

  it("contains scheduler failure synchronously", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(scheduleJevRecallShadow(input, {
      env: {
        OPENROUTER_API_KEY: "synthetic-key",
        CAPTURE_JEV_RECALL_SHADOW: "1",
      },
      schedule: () => { throw new Error("scheduler unavailable"); },
    })).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      "[capture] jev recall shadow failed",
      { name: "Error" }
    );
  });
});
