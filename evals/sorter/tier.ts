import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { wrapLanguageModel, type LanguageModelMiddleware } from "ai";
import { chain, type Tier } from "@/lib/providers";
import { subscriptionModel } from "@/lib/subscriptions.server";

/**
 * Which model a sorter eval runs on. Subscription first, always: the Claude
 * app signed in on this Mac (`claude`), Haiku 5.5 unless CAPTURE_EVAL_MODEL
 * says otherwise. It costs no API tokens, only the subscription's allowance,
 * and answers are cached by prompt so a rerun of unchanged code costs nothing.
 *
 * The production model (Cerebras) only with CAPTURE_EVAL_PROVIDER=cerebras,
 * for the one final check of what ships. Those calls are paid, and stop at
 * the daily ceiling in src/lib/evalBudget.server.ts (1M tokens).
 */

export const EVAL_HOME = process.env.CAPTURE_EVAL_HOME || path.join(homedir(), ".capture-eval");

function cached(name: string): LanguageModelMiddleware {
  const dir = path.join(EVAL_HOME, "cache", name);
  mkdirSync(dir, { recursive: true });
  return {
    specificationVersion: "v4",
    wrapGenerate: async ({ doGenerate, params }) => {
      const key = createHash("sha256").update(JSON.stringify({ prompt: params.prompt, format: params.responseFormat })).digest("hex");
      const file = path.join(dir, `${key}.json`);
      try {
        return JSON.parse(readFileSync(file, "utf8"));
      } catch { /* not asked before */ }
      const result = await doGenerate();
      writeFileSync(file, JSON.stringify(result));
      return result;
    },
  } as LanguageModelMiddleware;
}

export function evalTier(): Tier {
  const provider = process.env.CAPTURE_EVAL_PROVIDER ?? "subscription";
  if (provider === "subscription") {
    const model = process.env.CAPTURE_EVAL_MODEL ?? "claude-haiku-5-5";
    const name = "own-claude-subscription";
    return { name, model: wrapLanguageModel({ model: subscriptionModel("claude-subscription", model) as Parameters<typeof wrapLanguageModel>[0]["model"], middleware: cached(`subscription-${model}`) }) as Tier["model"] };
  }
  const tier = chain().find((candidate) => candidate.name === provider);
  if (!tier) throw new Error(`No ${provider} tier: set its API key, or use the subscription (the default).`);
  return { ...tier, model: wrapLanguageModel({ model: tier.model as Parameters<typeof wrapLanguageModel>[0]["model"], middleware: cached(provider) }) as Tier["model"] };
}

/** One line before a run: what it will use and roughly what it costs. */
export function announce(tier: Tier, sorts: number) {
  const paid = !tier.name.endsWith("-subscription");
  process.stderr.write(`${sorts} sorts on ${tier.name}` +
    (paid ? `, about ${Math.round((sorts * 8_500) / 1000)}K paid tokens (daily ceiling 1M; cached answers are free)\n` : " (subscription: no API tokens)\n"));
}
