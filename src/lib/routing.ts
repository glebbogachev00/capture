/**
 * Which provider does which job, and why.
 *
 * Every provider in the chain has its own per-minute allowance. Used as a
 * plain fallback list, one of them does all the work and rate-limits while
 * the other three sit idle — which is exactly what was happening. Spreading
 * the work across them is free capacity, and it costs nothing as long as
 * each job goes somewhere that can actually do it.
 *
 * Two questions decide where a job goes, in this order:
 *
 *   1. Is a person waiting on it?  A capture is being watched; a summary is
 *      not. Anything nobody is waiting on has no claim on the fast
 *      provider's budget.
 *
 *   2. Does the model choice measurably change the answer?  This is the one
 *      that surprised us, and it is why this file exists rather than a rule
 *      like "use the best model everywhere":
 *
 *        Routing a capture   — Mistral 77%, Claude Sonnet 74%. No
 *                              difference. The task is limited by how
 *                              overlapping the person's threads are, not by
 *                              the model, so paying for a better one buys
 *                              nothing.
 *
 *        Untangling threads  — Groq 100% recall, Mistral 22-43%. An enormous
 *                              difference. Here the model IS the ceiling.
 *
 * So: fast provider for what someone is waiting on, best-measured provider
 * for the judgements that need one, and everything else pushed onto the
 * allowances that would otherwise go unused.
 *
 * These are preferences, not pins. If the named provider is missing or
 * refuses, the rest of the chain still answers — spreading load must never
 * become a new way to fail.
 */

/** Each job, and the provider that should try it first. */
export const PREFERRED: Record<string, string | undefined> = {
  /* The semantic interpreter now decomposes source ownership, distinguishes
     intentions from plans, and routes several subjects in one response. Live
     output-level probes showed that this model choice materially changes the
     result, so sorting uses the provider that passed the current semantic
     contract rather than the old routing-only speed assumption. */
  sort: "openrouter",

  /* Nobody waits on a summary, and at ~2,300 tokens each they were the
     second-largest draw on the fast provider. Mistral is unmeasured here,
     but a summary that reads slightly worse costs far less than a capture
     that will not sort. */
  summarize: "mistral",

  /* Once a day, nobody waiting. Gemini's allowance is otherwise unused. */
  wrap: "gemini",

  /* Measured: 100% recall against 22-43%. The model is the ceiling, and it
     runs monthly, so it gets the good one regardless of cost. */
  untangle: "groq",

  /* Same shape of judgement as untangle, same reasoning. */
  organize: "groq",

  /* Deciding whether a word-match means anything is the same kind of
     judgement as untangle, where the model choice was worth 100% against
     22-43%. It is also the only thing standing between a coincidence and
     a suggestion, so it gets the measured-best provider. */
  judge: "groq",

  /* Left on the chain's own order: not measured, and not frequent enough to
     be worth guessing about. */
  distill: undefined,
  intention: undefined,
  group: undefined,
};

/** Providers that have passed the current source-grounded semantic Sort
 * contract. An unmeasured fallback may be available, but returning a plausible
 * wrong filing is worse than preserving the capture as pending. */
type SemanticSortTier = { name: string; modelId: string };

const SEMANTIC_SORT_MODELS = new Set([
  "openrouter:openai/gpt-5-mini",
]);

const PREVIEW_SEMANTIC_SORT_CANDIDATES = new Set([
  "groq:openai/gpt-oss-120b",
  "cerebras:gpt-oss-120b",
  "openrouter:google/gemini-3.8-flash",
  "gemini:gemini-3.8-flash",
]);

export function supportsSemanticSort(tier: SemanticSortTier): boolean {
  if (SEMANTIC_SORT_MODELS.has(`${tier.name}:${tier.modelId}`)) return true;
  /* Candidate models must be testable without admitting them to Production.
     The opt-in is deliberately Preview-only and exact-ID: a disposable build
     can measure one configured OpenRouter model, while unknown overrides keep
     failing closed everywhere else. */
  return (
    process.env.VERCEL_ENV === "preview" &&
    process.env.CAPTURE_SEMANTIC_SORT_CANDIDATE === "1" &&
    PREVIEW_SEMANTIC_SORT_CANDIDATES.has(`${tier.name}:${tier.modelId}`) &&
    (
      (tier.name === "groq" && tier.modelId === process.env.GROQ_MODEL) ||
      (tier.name === "cerebras" && tier.modelId === process.env.CEREBRAS_MODEL) ||
      (tier.name === "openrouter" && tier.modelId === process.env.OPENROUTER_MODEL) ||
      (tier.name === "gemini" && tier.modelId === process.env.GEMINI_MODEL)
    )
  );
}

/** The provider a job should try first, if it has an opinion. */
export function preferredFor(job: keyof typeof PREFERRED | string): string | undefined {
  return PREFERRED[job];
}
