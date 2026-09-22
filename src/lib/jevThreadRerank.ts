import { after } from "next/server";
import { z } from "zod";
import type { CloudAuthorization } from "./cloudRequestGuard";
import { scheduleManagedAiDeferredWork } from "./cloudRequestGuard.server";
import {
  OPENROUTER_DECISIONS_ENDPOINT,
  OpenRouterDecisionsError,
  submitOpenRouterDecisions,
} from "./openRouterDecisions.server";
import { countBucket, opsEvent } from "./opsEvent.server";

/**
 * Jev is not a chat model. OpenRouter serves it through the Decisions API,
 * which has a state + typed-questions contract separate from /chat/completions.
 */
export const JEV_OPENROUTER_ENDPOINT = OPENROUTER_DECISIONS_ENDPOINT;
export const JEV_OPENROUTER_MODEL = "typesafe/jev-1.13";

const MAX_CANDIDATES = 40;
const MAX_CAPTURE_CHARS = 2_000;
const MAX_NAME_CHARS = 120;
const MAX_ABOUT_CHARS = 700;

const DESTINATION_QUESTION = "destination";
const NEW_THREAD_OPTION = "new_thread";

type Env = Record<string, string | undefined>;
type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type Scheduler = (callback: () => void | Promise<void>) => void;

export type JevThreadCandidate = {
  id: string;
  name: string;
  about: string;
};

export type JevThreadRerankInput = {
  capture: string;
  candidates: JevThreadCandidate[];
  sorterThreadId?: string | null;
  sorterCreatedNewThread?: boolean;
};

type ExistingRank = {
  kind: "existing";
  threadId: string;
  candidateIndex: number;
  probability: number;
};

type NewThreadRank = {
  kind: "new_thread";
  probability: number;
};

export type JevThreadRerankResult = {
  selected: Omit<ExistingRank, "probability"> | { kind: "new_thread" };
  ranked: (ExistingRank | NewThreadRank)[];
  confidence: number;
  model: string;
  provider?: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cost?: number;
  };
};

const ChoiceAnswer = z.object({
  type: z.literal("choice"),
  choice: z.string(),
  confidence: z.number().min(0).max(1),
  probabilities: z.record(z.string(), z.number().min(0).max(1)),
});

const ThreadAnswers = z.strictObject({
  [DESTINATION_QUESTION]: ChoiceAnswer,
});

function clip(text: string, limit: number): string {
  const clean = text.trim();
  return clean.length <= limit ? clean : clean.slice(0, limit);
}

function limitedCandidates(candidates: JevThreadCandidate[]): JevThreadCandidate[] {
  return candidates.slice(0, MAX_CANDIDATES);
}

function optionFor(index: number): string {
  return `thread_${index}`;
}

/**
 * Build the raw OpenRouter Decisions request. Original thread ids stay local:
 * Jev sees only opaque option indexes and the bounded text needed to compare
 * destinations. The provider policy fails closed if ZDR/no-collection routing
 * is unavailable.
 */
export function buildJevThreadRerankRequest(input: JevThreadRerankInput) {
  const candidates = limitedCandidates(input.candidates);
  const criteria: Record<string, string> = {};
  candidates.forEach((candidate, index) => {
    const option = optionFor(index);
    const name = clip(candidate.name, MAX_NAME_CHARS);
    const about = clip(candidate.about, MAX_ABOUT_CHARS);
    criteria[option] = `Use the existing thread named "${name}". It is for: ${about || "No description yet."}`;
  });
  criteria[NEW_THREAD_OPTION] =
    "None of the existing threads is a clear home for this thinking; start a new thread instead.";

  return {
    model: JEV_OPENROUTER_MODEL,
    state: {
      capture: clip(input.capture, MAX_CAPTURE_CHARS),
    },
    questions: {
      [DESTINATION_QUESTION]: {
        type: "choice" as const,
        instructions:
          "Which destination is the clearest home for this thinking? Prefer an existing thread only when the capture genuinely belongs there. Choose new_thread when none clearly fits.",
        criteria,
      },
    },
  };
}

function validateOptionSet(
  answer: z.infer<typeof ChoiceAnswer>,
  candidates: JevThreadCandidate[]
): void {
  const expected = new Set([
    ...candidates.map((_, index) => optionFor(index)),
    NEW_THREAD_OPTION,
  ]);
  const actual = Object.keys(answer.probabilities);
  const probabilitySum = Object.values(answer.probabilities).reduce(
    (sum, probability) => sum + probability,
    0
  );
  if (
    !expected.has(answer.choice) ||
    actual.length !== expected.size ||
    actual.some((option) => !expected.has(option)) ||
    [...expected].some((option) => !(option in answer.probabilities)) ||
    Math.abs(probabilitySum - 1) > 0.001
  ) {
    throw new OpenRouterDecisionsError("invalid_response");
  }
}

/** One no-retry Decisions call. It never participates in Capture's sort result. */
export async function runJevThreadRerank(
  input: JevThreadRerankInput,
  options: { apiKey: string; fetcher?: Fetcher }
): Promise<JevThreadRerankResult> {
  const candidates = limitedCandidates(input.candidates);
  const request = buildJevThreadRerankRequest({ ...input, candidates });
  const parsed = await submitOpenRouterDecisions({
    apiKey: options.apiKey,
    ...request,
    answersSchema: ThreadAnswers,
    fetcher: options.fetcher,
  });

  const answer = parsed.answers[DESTINATION_QUESTION];
  validateOptionSet(answer, candidates);
  const ranked = Object.entries(answer.probabilities)
    .map(([option, probability]): ExistingRank | NewThreadRank => {
      if (option === NEW_THREAD_OPTION) return { kind: "new_thread", probability };
      const candidateIndex = Number(option.slice("thread_".length));
      return {
        kind: "existing",
        threadId: candidates[candidateIndex].id,
        candidateIndex,
        probability,
      };
    })
    .sort((a, b) => b.probability - a.probability);

  const selected =
    answer.choice === NEW_THREAD_OPTION
      ? ({ kind: "new_thread" } as const)
      : {
          kind: "existing" as const,
          threadId: candidates[Number(answer.choice.slice("thread_".length))].id,
          candidateIndex: Number(answer.choice.slice("thread_".length)),
        };

  return {
    selected,
    ranked,
    confidence: answer.confidence,
    model: parsed.model,
    provider: parsed.provider,
    usage: {
      inputTokens: parsed.usage.inputTokens,
      outputTokens: parsed.usage.outputTokens,
      cost: parsed.usage.cost,
    },
  };
}

export function isJevThreadRerankShadowEnabled(env: Env = process.env): boolean {
  return (
    env.CAPTURE_JEV_THREAD_RERANK_SHADOW === "1" &&
    Boolean(env.OPENROUTER_API_KEY)
  );
}


/**
 * Schedule a disabled-by-default shadow observation after the route response.
 * The task cannot alter, delay, or reject the normal sort. Logs contain only
 * aggregate comparison fields: never captures, candidate text, ids, or keys.
 */
export async function scheduleJevThreadRerankShadow(
  input: JevThreadRerankInput,
  options: {
    authorization?: CloudAuthorization;
    env?: Env;
    fetcher?: Fetcher;
    schedule?: Scheduler;
  } = {}
): Promise<boolean> {
  const env = options.env ?? process.env;
  const enabled =
    isJevThreadRerankShadowEnabled(env) &&
    Boolean(input.capture.trim()) &&
    input.candidates.length > 0 &&
    input.candidates.length <= MAX_CANDIDATES;
  const apiKey = env.OPENROUTER_API_KEY!;
  return scheduleManagedAiDeferredWork({
    authorization: options.authorization ?? { mode: "non-cloud" },
    enabled,
    schedule: options.schedule ?? after,
    work: async () => {
      await runJevThreadRerank(input, {
        apiKey,
        fetcher: options.fetcher,
      });
      opsEvent({
        event: "managed_ai_provider_attempt",
        outcome: "success",
        reason: "none",
        count: countBucket(Math.min(input.candidates.length, MAX_CANDIDATES)),
      });
    },
    onError: () => {
      opsEvent({ event: "managed_ai_provider_attempt", outcome: "failure", reason: "provider_unavailable", count: "one" });
    },
  });
}
