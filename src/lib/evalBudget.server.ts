import "server-only";

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { wrapLanguageModel, type LanguageModelMiddleware } from "ai";
import type { Tier } from "./providers";

/**
 * A hard daily ceiling on paid model tokens spent by anything that is not
 * the app itself: test harnesses, evals, one-off scripts.
 *
 * On 19 Oct 2026 one day of sorter testing sent 10.2M tokens to Cerebras
 * (1,283 test sorts), against about 90K on a normal day of real use. A note
 * saying "test less" did not stop it, so the providers stop it: outside the
 * running app, every call to a paid provider is counted in a file on this
 * machine, and once a day's tokens pass the ceiling, every further call
 * refuses before it is made. The app (Next sets NEXT_RUNTIME) and the unit
 * tests (which never reach a real provider) are untouched. Tests should run
 * on a Claude subscription first (evals/sorter); this is the backstop.
 */

export const EVAL_DAILY_TOKENS = 1_000_000;

export class EvalBudgetError extends Error {
  constructor(spent: number, ceiling: number) {
    super(`Daily test budget spent: ${spent.toLocaleString()} of ${ceiling.toLocaleString()} paid-model tokens today. ` +
      "Test on the Claude subscription instead (evals/sorter), or wait until tomorrow.");
    this.name = "EvalBudgetError";
  }
}

/** Anything running real models that is not the app or the unit tests.
 * `process.env.NEXT_RUNTIME` must stay written out literally: Next replaces
 * that exact expression with "nodejs" when it builds the app, and would not
 * see it through a variable, which would cap the app itself. */
export const outsideTheApp = () => !process.env.NEXT_RUNTIME && !process.env.VITEST;

type Env = Record<string, string | undefined>;
type Day = { tokens: number; calls: number };
type Ledger = Record<string, Day>;

export function ledgerFile(env: Env = process.env) {
  return env.CAPTURE_EVAL_LEDGER || path.join(homedir(), ".capture-eval", "paid-tokens.json");
}

const today = () => new Date().toLocaleDateString("en-CA");

function read(file: string): Ledger {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Ledger;
  } catch {
    return {};
  }
}

/** Tokens spent on paid models outside the app today. */
export const spentToday = (file = ledgerFile()) => read(file)[today()]?.tokens ?? 0;

function spend(file: string, tokens: number) {
  const ledger = read(file);
  const day = ledger[today()] ?? { tokens: 0, calls: 0 };
  ledger[today()] = { tokens: day.tokens + tokens, calls: day.calls + 1 };
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(ledger, null, 1));
}

const tokensIn = (usage: unknown): number => {
  const used = usage as { inputTokens?: unknown; outputTokens?: unknown } | undefined;
  const one = (value: unknown) => {
    const total = typeof value === "number" ? value : (value as { total?: unknown } | undefined)?.total;
    return typeof total === "number" && Number.isFinite(total) && total > 0 ? total : 0;
  };
  return one(used?.inputTokens) + one(used?.outputTokens);
};

function guard(file: string, ceiling: number): LanguageModelMiddleware {
  const check = () => {
    const spent = spentToday(file);
    if (spent >= ceiling) throw new EvalBudgetError(spent, ceiling);
  };
  return {
    specificationVersion: "v4",
    wrapGenerate: async ({ doGenerate }) => {
      check();
      const result = await doGenerate();
      spend(file, tokensIn(result.usage));
      return result;
    },
    wrapStream: async ({ doStream }) => {
      check();
      const result = await doStream();
      return {
        ...result,
        stream: result.stream.pipeThrough(new TransformStream({
          transform(part, controller) {
            if (part.type === "finish") spend(file, tokensIn(part.usage));
            controller.enqueue(part);
          },
        })),
      };
    },
  } as LanguageModelMiddleware;
}

/** Paid tiers, capped when called from outside the app. A subscription
 * (the claude or codex app on this Mac) is not a paid API call and is left
 * alone. */
export function budgeted(tiers: Tier[], env: Env = process.env, outside = outsideTheApp()): Tier[] {
  if (!outside) return tiers;
  const file = ledgerFile(env);
  const ceiling = Number(env.CAPTURE_EVAL_DAILY_TOKENS) > 0 ? Math.min(Number(env.CAPTURE_EVAL_DAILY_TOKENS), EVAL_DAILY_TOKENS) : EVAL_DAILY_TOKENS;
  return tiers.map((tier) => tier.name.endsWith("-subscription")
    ? tier
    : { ...tier, model: wrapLanguageModel({ model: tier.model as Parameters<typeof wrapLanguageModel>[0]["model"], middleware: guard(file, ceiling) }) as Tier["model"] });
}
