import { describe, expect, it, vi } from "vitest";
import { currentUsage, metered, withUsage } from "./aiUsage.server";
import { withManagedAiAdmission } from "./cloudRequestGuard.server";
import type { Tier } from "./providers";

/* A model that reports a fixed token use per call. */
const fake = (id: string, input: number, output: number) => ({
  specificationVersion: "v4", provider: "fake", modelId: id, supportedUrls: {},
  doGenerate: async () => ({
    content: [{ type: "text", text: "ok" }], finishReason: { unified: "stop", raw: "stop" }, warnings: [],
    usage: { inputTokens: { total: input }, outputTokens: { total: output } },
  }),
  doStream: async () => { throw new Error("not used"); },
}) as unknown as Tier["model"];
const call = (tier: Tier) => (tier.model as unknown as { doGenerate: (options: unknown) => Promise<unknown> }).doGenerate({ prompt: [] });

describe("counting a Cloud account's AI use", () => {
  it("adds up every call in a request by provider and model, and records once at the end", async () => {
    const record = vi.fn().mockResolvedValue(undefined);
    const cerebras: Tier = { name: "cerebras", model: fake("gpt-oss-120b", 100, 20) };
    const groq: Tier = { name: "groq", model: fake("gpt-oss-120b", 50, 5) };
    const answer = await withUsage("owner-a", async () => {
      await call(metered(cerebras));
      await call(metered(cerebras));
      await call(metered(groq));
      return "the answer";
    }, record);
    expect(answer).toBe("the answer");
    expect(record).toHaveBeenCalledTimes(1);
    const [owner, day, rows] = record.mock.calls[0];
    expect(owner).toBe("owner-a");
    expect(day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(rows).toEqual([
      { provider: "cerebras", model: "gpt-oss-120b", calls: 2, inputTokens: 200, outputTokens: 40 },
      { provider: "groq", model: "gpt-oss-120b", calls: 1, inputTokens: 50, outputTokens: 5 },
    ]);
  });

  it("never changes the request: an error passes through, and a failed write is ignored", async () => {
    const record = vi.fn().mockRejectedValue(new Error("no table yet"));
    const tier: Tier = { name: "cerebras", model: fake("m", 1, 1) };
    await expect(withUsage("owner-a", async () => { await call(metered(tier)); throw new Error("sort failed"); }, record))
      .rejects.toThrow("sort failed");
    expect(record).toHaveBeenCalledTimes(1);
    expect(await withUsage("owner-a", async () => "fine", record)).toBe("fine");
  });

  it("counts nothing outside a Cloud request", async () => {
    const tier: Tier = { name: "cerebras", model: fake("m", 1, 1) };
    expect(metered(tier)).toBe(tier);
    expect(await withManagedAiAdmission({ mode: "non-cloud" }, async () => currentUsage())).toBeUndefined();
  });

  it("is on for every Cloud member's AI request", async () => {
    const seen = await withManagedAiAdmission(
      { mode: "cloud", ownerId: "owner-a", admissionId: "lease", releaseExternalWork: async () => {} },
      async () => currentUsage(),
    );
    expect(seen).toBeDefined();
  });
});
