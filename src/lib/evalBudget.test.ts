import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EVAL_DAILY_TOKENS, EvalBudgetError, budgeted, outsideTheApp, spentToday } from "./evalBudget.server";
import type { Tier } from "./providers";

/* A model that reports a fixed token use per call. */
const fake = (tokens: number) => ({
  specificationVersion: "v4", provider: "fake", modelId: "fake", supportedUrls: {},
  doGenerate: async () => ({
    content: [{ type: "text", text: "ok" }], finishReason: { unified: "stop", raw: "stop" }, warnings: [],
    usage: { inputTokens: { total: tokens / 2 }, outputTokens: { total: tokens / 2 } },
  }),
  doStream: async () => { throw new Error("not used"); },
}) as unknown as Tier["model"];

const ledger = () => path.join(mkdtempSync(path.join(tmpdir(), "capture-eval-")), "paid-tokens.json");
const call = (tier: Tier) => (tier.model as unknown as { doGenerate: (options: unknown) => Promise<unknown> }).doGenerate({ prompt: [] });

describe("the daily ceiling on paid tokens outside the app", () => {
  it("never touches the app or the unit tests", () => {
    expect(outsideTheApp()).toBe(false); // vitest sets VITEST
    const tiers: Tier[] = [{ name: "cerebras", model: fake(10) }];
    expect(budgeted(tiers, {}, false)).toBe(tiers);
  });

  it("counts every paid call in a file and refuses once the day's ceiling is reached", async () => {
    const file = ledger();
    const env = { CAPTURE_EVAL_LEDGER: file, CAPTURE_EVAL_DAILY_TOKENS: "1000" };
    const [tier] = budgeted([{ name: "cerebras", model: fake(600) }], env, true);
    await call(tier);
    expect(spentToday(file)).toBe(600);
    await call(tier);
    expect(spentToday(file)).toBe(1200);
    await expect(call(tier)).rejects.toBeInstanceOf(EvalBudgetError);
    expect(spentToday(file)).toBe(1200);
    expect(Object.values(JSON.parse(readFileSync(file, "utf8")))).toEqual([{ tokens: 1200, calls: 2 }]);
  });

  it("can be lowered but never raised past the hard ceiling", async () => {
    const file = ledger();
    const [tier] = budgeted([{ name: "cerebras", model: fake(EVAL_DAILY_TOKENS) }],
      { CAPTURE_EVAL_LEDGER: file, CAPTURE_EVAL_DAILY_TOKENS: String(EVAL_DAILY_TOKENS * 50) }, true);
    await call(tier);
    await expect(call(tier)).rejects.toBeInstanceOf(EvalBudgetError);
  });

  it("leaves a subscription alone: it is not a paid API call", async () => {
    const file = ledger();
    const sub: Tier = { name: "own-claude-subscription", model: fake(5000) };
    const [kept] = budgeted([sub], { CAPTURE_EVAL_LEDGER: file, CAPTURE_EVAL_DAILY_TOKENS: "1" }, true);
    expect(kept).toBe(sub);
  });
});
