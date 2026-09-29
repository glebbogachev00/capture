import { describe, expect, it, vi } from "vitest";
import { generatePlannedRoutingCandidate } from "./plannedRoutingGeneration";

const ai = vi.hoisted(() => ({ generateObject: vi.fn() }));
vi.mock("ai", () => ai);

describe("planned routing reasoning budget", () => {
  it("gives the Cerebras planner medium reasoning without changing the shared tier", async () => {
    const tier = {
      name: "cerebras",
      model: "model" as never,
      providerOptions: { cerebras: { reasoningEffort: "low", reasoningFormat: "hidden" } },
    };
    ai.generateObject.mockResolvedValue({ object: { items: [], newThreads: [] } });
    await generatePlannedRoutingCandidate({ tier, prompt: "synthetic", abortSignal: new AbortController().signal });
    expect(ai.generateObject).toHaveBeenLastCalledWith(expect.objectContaining({
      maxRetries: 0,
      providerOptions: { cerebras: { reasoningEffort: "medium", reasoningFormat: "hidden" } },
    }));
    expect(tier.providerOptions.cerebras.reasoningEffort).toBe("low");
  });

  it("preserves another provider's configured options", async () => {
    const tier = { name: "gemini", model: "model" as never, providerOptions: { google: { thinkingConfig: { thinkingLevel: "low" } } } };
    ai.generateObject.mockResolvedValue({ object: { items: [], newThreads: [] } });
    await generatePlannedRoutingCandidate({ tier, prompt: "synthetic", abortSignal: new AbortController().signal });
    expect(ai.generateObject).toHaveBeenLastCalledWith(expect.objectContaining({ providerOptions: tier.providerOptions }));
  });
});
