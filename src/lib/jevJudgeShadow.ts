import { after } from "next/server";
import { z } from "zod";

import type { CloudAuthorization } from "./cloudRequestGuard";
import { scheduleManagedAiDeferredWork } from "./cloudRequestGuard.server";
import { submitOpenRouterDecisions } from "./openRouterDecisions.server";
import { countBucket, opsEvent } from "./opsEvent.server";

export const JEV_JUDGE_MODEL = "typesafe/jev-1.13";

const MAX_CANDIDATES = 14;
const MAX_KIND_CHARS = 80;
const MAX_SOURCE_CHARS = 400;
const MAX_TARGET_CHARS = 400;
const MAX_CONTEXT_CHARS = 700;

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

/**
 * Observe Jev only after the generative judge has already answered. There is
 * deliberately no prefilter function: missing/malformed/timeout/privacy errors
 * and every confidence level leave the full original candidate batch intact.
 */
export async function scheduleJevJudgeShadow(
  input: JevJudgeShadowInput,
  options: {
    authorization?: CloudAuthorization;
    env?: Env;
    fetcher?: Fetcher;
    schedule?: Scheduler;
  } = {}
): Promise<boolean> {
  const env = options.env ?? process.env;
  const enabled =
    isJevJudgeShadowEnabled(env) &&
    input.candidates.length > 0 &&
    input.candidates.length <= MAX_CANDIDATES;
  const apiKey = env.OPENROUTER_API_KEY!;
  return scheduleManagedAiDeferredWork({
    authorization: options.authorization ?? { mode: "non-cloud" },
    enabled,
    schedule: options.schedule ?? after,
    work: async () => {
      await runJevJudgeShadow(input, {
        apiKey,
        fetcher: options.fetcher,
      });
      opsEvent({
        event: "managed_ai_provider_attempt",
        outcome: "success",
        reason: "none",
        count: countBucket(input.candidates.length),
      });
    },
    onError: () => {
      opsEvent({ event: "managed_ai_provider_attempt", outcome: "failure", reason: "provider_unavailable", count: "one" });
    },
  });
}
