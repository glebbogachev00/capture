import { createCerebras } from "@ai-sdk/cerebras";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  planRoutingWithRetry,
  RoutingPlanValidationError,
  type PlannedRoutingPlan,
} from "./plannedRouting";
import { generatePlannedRoutingCandidate } from "./plannedRoutingGeneration";
import { chain } from "./providers";

const ALL_KEYS = [
  "OPENROUTER_API_KEY",
  "GROQ_API_KEY",
  "GROQ_API_KEY_2",
  "CEREBRAS_API_KEY",
  "MISTRAL_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
];

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("chain", () => {
  it("tries both Groq keys, Cerebras, Mistral, Gemini, then OpenRouter when every key is present", () => {
    for (const k of ALL_KEYS) vi.stubEnv(k, "test-key");
    expect(chain().map((t) => t.name)).toEqual([
      "groq",
      "groq-2",
      "cerebras",
      "mistral",
      "gemini",
      "openrouter",
    ]);
  });

  it("skips a tier whose key is absent", () => {
    for (const k of ALL_KEYS) vi.stubEnv(k, "test-key");
    vi.stubEnv("MISTRAL_API_KEY", "");
    expect(chain().map((t) => t.name)).toEqual([
      "groq",
      "groq-2",
      "cerebras",
      "gemini",
      "openrouter",
    ]);
  });

  it("returns an empty chain when nothing is configured", () => {
    for (const k of ALL_KEYS) vi.stubEnv(k, "");
    expect(chain()).toEqual([]);
  });

  it("supports OpenRouter as the only configured provider", () => {
    for (const k of ALL_KEYS) vi.stubEnv(k, "");
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    vi.stubEnv("OPENROUTER_MODEL", "provider/paid-model");

    expect(chain().map((tier) => tier.name)).toEqual(["openrouter"]);
  });

  it("moves the configured preferred provider to the front without removing fallbacks", () => {
    for (const k of ALL_KEYS) vi.stubEnv(k, "test-key");
    vi.stubEnv("CAPTURE_MODEL_PROVIDER", "openrouter");

    expect(chain().map((t) => t.name)).toEqual([
      "openrouter",
      "groq",
      "groq-2",
      "cerebras",
      "mistral",
      "gemini",
    ]);
  });

  it("ignores a preferred provider that is not configured", () => {
    for (const k of ALL_KEYS) vi.stubEnv(k, "test-key");
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubEnv("CAPTURE_MODEL_PROVIDER", "openrouter");

    expect(chain().map((t) => t.name)).toEqual([
      "groq",
      "groq-2",
      "cerebras",
      "mistral",
      "gemini",
    ]);
  });

  it("defaults Cerebras to gpt-oss-120b unless CEREBRAS_MODEL overrides it", () => {
    const idOf = (tier?: { model: unknown }) =>
      (tier?.model as unknown as { modelId: string }).modelId;
    vi.stubEnv("CEREBRAS_API_KEY", "test-key");
    vi.stubEnv("CEREBRAS_MODEL", "");
    expect(idOf(chain().find((t) => t.name === "cerebras"))).toBe(
      "gpt-oss-120b"
    );

    vi.stubEnv("CEREBRAS_MODEL", "qwen-3.8-27b");
    expect(idOf(chain().find((t) => t.name === "cerebras"))).toBe(
      "qwen-3.8-27b"
    );
  });

  it("defaults Mistral to mistral-small-latest unless MISTRAL_MODEL overrides it", () => {
    // LanguageModel's id isn't on the public type; read it from the runtime
    // object, which carries modelId like every provider instance does.
    const idOf = (tier?: { model: unknown }) =>
      (tier?.model as unknown as { modelId: string }).modelId;
    vi.stubEnv("MISTRAL_API_KEY", "test-key");
    // Clear the override first so a host env can't leak into the default.
    vi.stubEnv("MISTRAL_MODEL", "");
    expect(idOf(chain().find((t) => t.name === "mistral"))).toBe(
      "mistral-small-latest"
    );

    vi.stubEnv("MISTRAL_MODEL", "mistral-large-latest");
    expect(idOf(chain().find((t) => t.name === "mistral"))).toBe(
      "mistral-large-latest"
    );
  });

  it("defaults OpenRouter to a free model unless OPENROUTER_MODEL overrides it", () => {
    const idOf = (tier?: { model: unknown }) =>
      (tier?.model as unknown as { modelId: string }).modelId;
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    // The tier is last-resort: without credits the default must be free.
    vi.stubEnv("OPENROUTER_MODEL", "");
    expect(idOf(chain().find((t) => t.name === "openrouter"))).toContain(":free");

    vi.stubEnv("OPENROUTER_MODEL", "anthropic/claude-sonnet-4.5");
    expect(idOf(chain().find((t) => t.name === "openrouter"))).toBe(
      "anthropic/claude-sonnet-4.5"
    );
  });
});

describe("planned-routing provider transport", () => {
  const raw = "Draft labels tomorrow.";
  const validPlan: PlannedRoutingPlan = {
    items: [{
      id: "draft-action",
      source: raw,
      kind: "action",
      action: raw,
      due: null,
      ownerId: null,
      destinations: [],
      duplicateActionId: null,
      unresolved: false,
      ambiguity: null,
    }],
    newThreads: [],
  };
  const context = {
    captureId: "capture-one",
    raw,
    threads: [],
    actions: [],
    recovery: {
      clean: raw,
      kind: "action" as const,
      title: "Draft labels",
      actions: [raw],
      primaryActions: [],
      shelfLife: "days" as const,
      due: null,
      threadId: null,
      threadName: null,
      primaryText: null,
      also: [],
    },
    now: new Date("2026-09-29T12:00:00+07:00").getTime(),
  };

  const response = (content: string) => new Response(JSON.stringify({
    id: "synthetic-response",
    model: "gpt-oss-120b",
    choices: [{
      index: 0,
      finish_reason: "stop",
      message: { role: "assistant", content },
    }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  }), { status: 200, headers: { "content-type": "application/json" } });

  function cerebrasHarness(outputs: string[]) {
    const requestBodies: Record<string, unknown>[] = [];
    const model = createCerebras({
      apiKey: "synthetic-key",
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        requestBodies.push(body);
        return response(outputs.shift() ?? "");
      },
    })("gpt-oss-120b");
    return {
      requestBodies,
      tier: {
        name: "cerebras",
        model,
        providerOptions: {
          cerebras: { reasoningEffort: "low", reasoningFormat: "hidden" },
        },
      },
    };
  }

  it("sends Cerebras json_object with no JSON Schema and preserves provider options", async () => {
    const harness = cerebrasHarness([JSON.stringify(validPlan)]);

    await expect(generatePlannedRoutingCandidate({
      tier: harness.tier,
      prompt: "Return the complete routing plan JSON object.",
      abortSignal: AbortSignal.timeout(1_000),
    })).resolves.toEqual(validPlan);

    expect(harness.requestBodies).toHaveLength(1);
    expect(harness.requestBodies[0]?.reasoning_effort).toBe("medium");
    expect(harness.requestBodies[0]?.reasoning_format).toBe("hidden");
    expect(harness.requestBodies[0]?.response_format).toEqual({ type: "json_object" });
    expect(JSON.stringify(harness.requestBodies[0])).not.toContain("json_schema");
  });

  it("locally rejects an invalid Cerebras object and retries once with validation feedback", async () => {
    const harness = cerebrasHarness([
      JSON.stringify({ items: [], newThreads: [] }),
      JSON.stringify(validPlan),
    ]);

    await expect(planRoutingWithRetry(context, (failures) =>
      generatePlannedRoutingCandidate({
        tier: harness.tier,
        prompt: `feedback:${JSON.stringify(failures)}`,
        abortSignal: AbortSignal.timeout(1_000),
      })
    )).resolves.toMatchObject({ plan: validPlan, attempts: 2 });

    expect(harness.requestBodies).toHaveLength(2);
    expect(JSON.stringify(harness.requestBodies[1]?.messages)).toContain("MALFORMED_PLAN");
    expect(harness.requestBodies.every((body) =>
      JSON.stringify(body.response_format) === JSON.stringify({ type: "json_object" }) &&
      !JSON.stringify(body).includes("json_schema")
    )).toBe(true);
  });

  it("rejects malformed Cerebras text after the one bounded retry", async () => {
    const harness = cerebrasHarness(["not json", "```json\n{}\n```"]);

    await expect(planRoutingWithRetry(context, (failures) =>
      generatePlannedRoutingCandidate({
        tier: harness.tier,
        prompt: `feedback:${JSON.stringify(failures)}`,
        abortSignal: AbortSignal.timeout(1_000),
      })
    )).rejects.toBeInstanceOf(RoutingPlanValidationError);

    expect(harness.requestBodies).toHaveLength(2);
    expect(JSON.stringify(harness.requestBodies[1]?.messages)).toContain("MALFORMED_PLAN");
  });
});
