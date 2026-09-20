import { after } from "next/server";
import { z } from "zod";

import {
  safeOpenRouterDecisionsFailure,
  submitOpenRouterDecisions,
} from "./openRouterDecisions.server";

export const JEV_JUDGE_MODEL = "typesafe/jev-1.13";

const MAX_CANDIDATES = 14;
const MAX_KIND_CHARS = 80;
const MAX_SOURCE_CHARS = 400;
const MAX_TARGET_CHARS = 400;
const MAX_CONTEXT_CHARS = 700;
const HISTOGRAM_BUCKETS = 10;

type Env = Record<string, string | undefined>;
type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type Scheduler = (callback: () => void | Promise<void>) => void;

export type JevJudgeCandidate = {
  id: string;
  kind: string;
  source: string;
  target: string;
  targetContext?: string;
};

export type JevJudgeVerdict = {
  id: string;
  keep: boolean;
  reason: string | null;
};

export type JevJudgeShadowInput = {
  candidates: JevJudgeCandidate[];
  generativeVerdicts: JevJudgeVerdict[];
};

type NoulAnswer = { type: "noul"; noul: number };

const NoulAnswerSchema = z.strictObject({
  type: z.literal("noul"),
  noul: z.number().min(0).max(1),
});

const clip = (text: string, limit: number): string => {
  const trimmed = text.trim();
  return trimmed.length <= limit ? trimmed : trimmed.slice(0, limit);
};

const labelFor = (index: number): string => `candidate_${index}`;

/** Build only feature state/questions; the transport injects privacy policy. */
export function buildJevJudgeRequest(input: JevJudgeShadowInput) {
  if (input.candidates.length > MAX_CANDIDATES) {
    throw new Error("too many Jev judge candidates");
  }
  const candidates = input.candidates;
  const state: Record<string, {
    kind: string;
    source: string;
    target: string;
    targetContext?: string;
  }> = {};
  const questions: Record<string, {
    type: "noul";
    instructions: string;
    criteria: { true: string; false: string };
  }> = {};

  candidates.forEach((candidate, index) => {
    const label = labelFor(index);
    state[label] = {
      kind: clip(candidate.kind, MAX_KIND_CHARS),
      source: clip(candidate.source, MAX_SOURCE_CHARS),
      target: clip(candidate.target, MAX_TARGET_CHARS),
      ...(candidate.targetContext
        ? { targetContext: clip(candidate.targetContext, MAX_CONTEXT_CHARS) }
        : {}),
    };
    questions[label] = {
      type: "noul",
      instructions: `Should ${label} be kept as a useful organizer suggestion?`,
      criteria: {
        true:
          "The source and target express the same task or idea, or the source clearly belongs in the target based on meaning rather than shared words.",
        false:
          "They merely share wording or a broad topic, express distinct work, or the relationship is uncertain.",
      },
    };
  });

  return {
    model: JEV_JUDGE_MODEL,
    state,
    questions,
  };
}

function answersSchema(count: number) {
  const shape: Record<string, typeof NoulAnswerSchema> = {};
  for (let index = 0; index < count; index += 1) {
    shape[labelFor(index)] = NoulAnswerSchema;
  }
  return z.strictObject(shape);
}

export async function runJevJudgeShadow(
  input: JevJudgeShadowInput,
  options: { apiKey: string; fetcher?: Fetcher }
): Promise<{
  scores: { candidateIndex: number; noul: number }[];
  model: string;
  provider?: string;
  usage: { inputTokens: number; outputTokens: number; cost?: number };
}> {
  const candidates = input.candidates;
  const request = buildJevJudgeRequest({ ...input, candidates });
  const response = await submitOpenRouterDecisions({
    apiKey: options.apiKey,
    ...request,
    answersSchema: answersSchema(candidates.length),
    fetcher: options.fetcher,
  });
  const answers = response.answers as Record<string, NoulAnswer>;

  return {
    scores: candidates.map((_, candidateIndex) => ({
      candidateIndex,
      noul: answers[labelFor(candidateIndex)].noul,
    })),
    model: response.model,
    provider: response.provider,
    usage: response.usage,
  };
}

export function isJevJudgeShadowEnabled(env: Env = process.env): boolean {
  return env.CAPTURE_JEV_JUDGE_SHADOW === "1" && Boolean(env.OPENROUTER_API_KEY);
}

function histogram(values: number[]): number[] {
  const buckets = Array.from({ length: HISTOGRAM_BUCKETS }, () => 0);
  values.forEach((value) => {
    buckets[Math.min(HISTOGRAM_BUCKETS - 1, Math.floor(value * HISTOGRAM_BUCKETS))] += 1;
  });
  return buckets;
}

/**
 * Observe Jev only after the generative judge has already answered. There is
 * deliberately no prefilter function: missing/malformed/timeout/privacy errors
 * and every confidence level leave the full original candidate batch intact.
 */
export function scheduleJevJudgeShadow(
  input: JevJudgeShadowInput,
  options: {
    env?: Env;
    fetcher?: Fetcher;
    schedule?: Scheduler;
  } = {}
): boolean {
  const env = options.env ?? process.env;
  if (
    !isJevJudgeShadowEnabled(env) ||
    !input.candidates.length ||
    input.candidates.length > MAX_CANDIDATES
  ) {
    return false;
  }

  const apiKey = env.OPENROUTER_API_KEY!;
  const schedule = options.schedule ?? after;
  const task = async () => {
    try {
      const result = await runJevJudgeShadow(input, {
        apiKey,
        fetcher: options.fetcher,
      });
      const keptIds = new Set(
        input.generativeVerdicts.filter((verdict) => verdict.keep).map((verdict) => verdict.id)
      );
      const keptScores = result.scores
        .filter(({ candidateIndex }) => keptIds.has(input.candidates[candidateIndex].id))
        .map(({ noul }) => noul);
      console.info("[capture] jev judge shadow", {
        candidateCount: input.candidates.length,
        generativeKeepCount: keptIds.size,
        generativeKeepScoreHistogram: histogram(keptScores),
        inputTokens: result.usage.inputTokens,
        scoreHistogram: histogram(result.scores.map(({ noul }) => noul)),
      });
    } catch (error) {
      console.warn(
        "[capture] jev judge shadow failed",
        safeOpenRouterDecisionsFailure(error)
      );
    }
  };

  try {
    schedule(task);
    return true;
  } catch (error) {
    console.warn(
      "[capture] jev judge shadow failed",
      safeOpenRouterDecisionsFailure(error)
    );
    return false;
  }
}
