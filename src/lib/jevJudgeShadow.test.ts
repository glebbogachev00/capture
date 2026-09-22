import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  JEV_JUDGE_MODEL,
  buildJevJudgeRequest,
  isJevJudgeShadowEnabled,
  runJevJudgeShadow,
  scheduleJevJudgeShadow,
} from "./jevJudgeShadow";

const candidates = [
  {
    id: "private-fold-action-a-thread-a",
    kind: "fold_action",
    source: "Compare annual and monthly pricing",
    target: "Pricing decisions",
    targetContext: "Notes about packaging and annual-plan tradeoffs.",
  },
  {
    id: "private-fold-action-b-thread-b",
    kind: "fold_action",
    source: "Call the vet about Luna's shots",
    target: "Webhook reliability",
    targetContext: "Retry timing and failed deliveries.",
  },
];

const input = {
  candidates,
  generativeVerdicts: [
    { id: candidates[0].id, keep: true, reason: "Same pricing decision" },
    { id: candidates[1].id, keep: false, reason: null },
  ],
};

const successResponse = () => Response.json({
  answers: {
    candidate_0: { type: "noul", noul: 0.91 },
    candidate_1: { type: "noul", noul: 0.08 },
  },
  model: "typesafe/jev-1.13-20260917",
  provider: "TypeSafe",
  usage: { input_tokens: 180, output_tokens: 8, cost: 0.000008 },
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Jev judge request", () => {
  it("uses one Noul question per candidate with opaque labels and bounded text", () => {
    const request = buildJevJudgeRequest({
      ...input,
      candidates: candidates.map((candidate) => ({
        ...candidate,
        kind: candidate.kind.repeat(100),
        source: candidate.source.repeat(100),
        target: candidate.target.repeat(100),
        targetContext: candidate.targetContext.repeat(100),
      })),
    });
    const labels = ["candidate_0", "candidate_1"];

    expect(request.model).toBe(JEV_JUDGE_MODEL);
    expect(Object.keys(request.questions)).toEqual(labels);
    expect(Object.values(request.questions).every((question) => question.type === "noul")).toBe(true);
    expect(Object.keys(request.state)).toEqual(labels);
    expect(request.state.candidate_0.kind.length).toBeLessThanOrEqual(80);
    expect(request.state.candidate_0.source.length).toBeLessThanOrEqual(400);
    expect(request.state.candidate_0.target.length).toBeLessThanOrEqual(400);
    expect(request.state.candidate_0.targetContext?.length).toBeLessThanOrEqual(700);
    const serialized = JSON.stringify(request);
    expect(serialized).not.toContain(candidates[0].id);
    expect(serialized).not.toContain(candidates[1].id);
  });

  it("maps a complete answer set back to local candidate indexes", async () => {
    const fetcher = vi.fn(async () => successResponse());

    const result = await runJevJudgeShadow(input, {
      apiKey: "synthetic-key",
      fetcher,
    });

    expect(fetcher).toHaveBeenCalledOnce();
    expect(result.scores).toEqual([
      { candidateIndex: 0, noul: 0.91 },
      { candidateIndex: 1, noul: 0.08 },
    ]);
  });

  it("rejects missing candidate answers instead of guessing", async () => {
    await expect(runJevJudgeShadow(input, {
      apiKey: "synthetic-key",
      fetcher: async () => Response.json({
        answers: { candidate_0: { type: "noul", noul: 0.91 } },
        model: "typesafe/jev-1.13-20260917",
        usage: { input_tokens: 100, output_tokens: 4 },
      }),
    })).rejects.toMatchObject({ code: "invalid_response" });
  });
});

describe("Jev judge shadow gate", () => {
  it("is disabled unless its own flag and the OpenRouter key are present", () => {
    expect(isJevJudgeShadowEnabled({})).toBe(false);
    expect(isJevJudgeShadowEnabled({
      OPENROUTER_API_KEY: "synthetic-key",
      CAPTURE_JEV_THREAD_RERANK_SHADOW: "1",
    })).toBe(false);
    expect(isJevJudgeShadowEnabled({
      OPENROUTER_API_KEY: "synthetic-key",
      CAPTURE_JEV_JUDGE_SHADOW: "1",
    })).toBe(true);
  });

  it("does not schedule or call the network while disabled", async () => {
    const schedule = vi.fn();
    const fetcher = vi.fn();
    const acquire = vi.fn();
    expect(await scheduleJevJudgeShadow(input, {
      authorization: { mode: "cloud", ownerId: "owner-a", acquireDeferredManagedAiAdmission: acquire },
      env: {}, schedule, fetcher,
    })).toBe(false);
    expect(acquire).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("skips an oversized batch rather than observing only part of it", async () => {
    const schedule = vi.fn();
    const fetcher = vi.fn();
    const oversized = Array.from({ length: 15 }, (_, index) => ({
      id: `candidate-${index}`,
      kind: "fold_action",
      source: `Synthetic source ${index}`,
      target: `Synthetic target ${index}`,
    }));

    expect(await scheduleJevJudgeShadow({
      candidates: oversized,
      generativeVerdicts: [],
    }, {
      env: {
        OPENROUTER_API_KEY: "synthetic-key",
        CAPTURE_JEV_JUDGE_SHADOW: "1",
      },
      schedule,
      fetcher,
    })).toBe(false);
    expect(schedule).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("logs only aggregate non-content observations", async () => {
    let task: (() => void | Promise<void>) | undefined;
    const schedule = vi.fn((callback: () => void | Promise<void>) => {
      task = callback;
    });
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const release = vi.fn().mockResolvedValue(undefined);
    const acquire = vi.fn().mockResolvedValue({ release });

    expect(await scheduleJevJudgeShadow(input, {
      authorization: {
        mode: "cloud",
        ownerId: "owner-a",
        acquireDeferredManagedAiAdmission: acquire,
      },
      env: {
        OPENROUTER_API_KEY: "synthetic-key",
        CAPTURE_JEV_JUDGE_SHADOW: "1",
      },
      schedule,
      fetcher: async () => successResponse(),
    })).toBe(true);
    expect(acquire).toHaveBeenCalledOnce();
    expect(release).not.toHaveBeenCalled();
    await Promise.resolve(task?.());
    expect(release).toHaveBeenCalledOnce();

    expect(info).toHaveBeenCalledWith("[capture-ops]", {
      version: 1,
      event: "managed_ai_provider_attempt",
      outcome: "success",
      reason: "none",
      latency: "not_measured",
      count: "2_9",
    });
    const logged = JSON.stringify(info.mock.calls);
    expect(logged).not.toContain(candidates[0].source);
    expect(logged).not.toContain(candidates[0].id);
    expect(logged).not.toContain("synthetic-key");
  });

  it.each([
    ["malformed", async () => Response.json({ answers: {}, model: "bad", usage: {} })],
    ["privacy routing refusal", async () => new Response("private provider error", { status: 503 })],
    ["timeout", async () => { throw new DOMException("timed out", "TimeoutError"); }],
  ])("contains %s and leaves the already-computed generative verdicts untouched", async (_name, fetcher) => {
    let task: (() => void | Promise<void>) | undefined;
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const original = structuredClone(input.generativeVerdicts);

    expect(await scheduleJevJudgeShadow(input, {
      env: {
        OPENROUTER_API_KEY: "synthetic-key",
        CAPTURE_JEV_JUDGE_SHADOW: "1",
      },
      schedule: (callback) => { task = callback; },
      fetcher,
    })).toBe(true);
    await expect(Promise.resolve(task?.())).resolves.toBeUndefined();

    expect(input.generativeVerdicts).toEqual(original);
    expect(info).toHaveBeenCalledWith("[capture-ops]", {
      version: 1,
      event: "managed_ai_provider_attempt",
      outcome: "failure",
      reason: "provider_unavailable",
      latency: "not_measured",
      count: "one",
    });
    expect(JSON.stringify(info.mock.calls)).not.toContain(candidates[0].source);
  });
});
