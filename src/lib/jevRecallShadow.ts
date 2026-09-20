import { after } from "next/server";
import { z } from "zod";

import type { RecallAnswer, RecallSource } from "./recall";
import {
  OpenRouterDecisionsError,
  safeOpenRouterDecisionsFailure,
  submitOpenRouterDecisions,
} from "./openRouterDecisions.server";

export const JEV_RECALL_MODEL = "typesafe/jev-1.13";

const MAX_SOURCES = 12;
const MAX_QUESTION_CHARS = 500;
const MAX_EXCERPT_CHARS = 1_000;
const HISTOGRAM_BUCKETS = 10;

const INTENT_QUESTION = "query_intent";
const SOURCE_QUESTION = "best_source";
const SUFFICIENCY_QUESTION = "evidence_sufficient";
const NONE_OPTION = "none";
const INTENT_OPTIONS = ["find_notes", "answer_fact", "synthesize", "unclear"] as const;

export type JevRecallIntent = typeof INTENT_OPTIONS[number];
type Env = Record<string, string | undefined>;
type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type Scheduler = (callback: () => void | Promise<void>) => void;

export type JevRecallShadowInput = {
  question: string;
  sources: RecallSource[];
  authoritativeAnswer: RecallAnswer;
};

type ChoiceAnswer = {
  type: "choice";
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
};

const ChoiceAnswerSchema = z.strictObject({
  type: z.literal("choice"),
  choice: z.string(),
  confidence: z.number().min(0).max(1),
  probabilities: z.record(z.string(), z.number().min(0).max(1)),
});

const NoulAnswerSchema = z.strictObject({
  type: z.literal("noul"),
  noul: z.number().min(0).max(1),
});

const RecallAnswersSchema = z.strictObject({
  [INTENT_QUESTION]: ChoiceAnswerSchema,
  [SOURCE_QUESTION]: ChoiceAnswerSchema,
  [SUFFICIENCY_QUESTION]: NoulAnswerSchema,
});

const clip = (text: string, limit: number): string => {
  const trimmed = text.trim();
  return trimmed.length <= limit ? trimmed : trimmed.slice(0, limit);
};

const sourceLabel = (index: number): string => `source_${index}`;

function sourceOptions(count: number): string[] {
  return [
    ...Array.from({ length: count }, (_, index) => sourceLabel(index)),
    NONE_OPTION,
  ];
}

/**
 * Build only the Recall decision state. Structured source metadata, answer
 * prose, and citations do not cross this boundary. The bounded question and
 * excerpts remain verbatim apart from trimming/clipping; they are not redacted.
 */
export function buildJevRecallRequest(input: JevRecallShadowInput) {
  if (!input.question.trim() || !input.sources.length || input.sources.length > MAX_SOURCES) {
    throw new Error("invalid Jev Recall shadow input");
  }

  const sources = Object.fromEntries(input.sources.map((source, index) => [
    sourceLabel(index),
    { excerpt: clip(source.text, MAX_EXCERPT_CHARS) },
  ]));
  const sourceCriteria = Object.fromEntries(input.sources.map((_, index) => [
    sourceLabel(index),
    "This labeled excerpt is the strongest direct evidence for the question.",
  ]));
  sourceCriteria[NONE_OPTION] =
    "None of the labeled excerpts is direct evidence for the question.";

  return {
    model: JEV_RECALL_MODEL,
    state: {
      question: clip(input.question, MAX_QUESTION_CHARS),
      sources,
    },
    questions: {
      [INTENT_QUESTION]: {
        type: "choice" as const,
        instructions:
          "Classify the person's likely intent. Choose find_notes for navigation or retrieval, answer_fact for a direct factual answer, synthesize for comparison or summary across excerpts, and unclear when the intent is not stable enough to automate.",
        criteria: {
          find_notes: "Locate or navigate to relevant saved material without writing an answer.",
          answer_fact: "Return a direct factual answer supported by saved material.",
          synthesize: "Compare or summarize information across saved material.",
          unclear: "The request is ambiguous or is not clearly one of the other intents.",
        },
      },
      [SOURCE_QUESTION]: {
        type: "choice" as const,
        instructions:
          "Rank which opaque source label is the strongest direct evidence for the question. Choose none when no excerpt directly supports it.",
        criteria: sourceCriteria,
      },
      [SUFFICIENCY_QUESTION]: {
        type: "noul" as const,
        instructions:
          "Do the submitted labeled excerpts directly support a complete answer to the question?",
        criteria: {
          true: "The excerpts directly support a complete answer without outside knowledge.",
          false: "The excerpts are irrelevant, incomplete, contradictory without resolution, or support only part of the requested answer.",
        },
      },
    },
  };
}

function validateChoice(answer: ChoiceAnswer, expectedOptions: readonly string[]): void {
  const expected = new Set(expectedOptions);
  const actual = Object.keys(answer.probabilities);
  const probabilities = Object.values(answer.probabilities);
  const sum = probabilities.reduce(
    (total, probability) => total + probability,
    0
  );
  const selectedProbability = answer.probabilities[answer.choice];
  const maximumProbability = Math.max(...probabilities);
  if (
    !expected.has(answer.choice) ||
    actual.length !== expected.size ||
    actual.some((option) => !expected.has(option)) ||
    [...expected].some((option) => !(option in answer.probabilities)) ||
    Math.abs(sum - 1) > 0.001 ||
    selectedProbability < maximumProbability
  ) {
    throw new OpenRouterDecisionsError("invalid_response");
  }
}

export type JevRecallShadowResult = {
  intent: JevRecallIntent;
  intentConfidence: number;
  rankedSources: (
    | { kind: "source"; sourceIndex: number; probability: number }
    | { kind: "none"; probability: number }
  )[];
  sufficiency: number;
  model: string;
  provider?: string;
  usage: { inputTokens: number; outputTokens: number; cost?: number };
};

/** One combined, no-retry decision call. It cannot generate the Recall answer. */
export async function runJevRecallShadow(
  input: JevRecallShadowInput,
  options: { apiKey: string; fetcher?: Fetcher }
): Promise<JevRecallShadowResult> {
  const request = buildJevRecallRequest(input);
  const response = await submitOpenRouterDecisions({
    apiKey: options.apiKey,
    ...request,
    answersSchema: RecallAnswersSchema,
    fetcher: options.fetcher,
  });
  const intent = response.answers[INTENT_QUESTION];
  const bestSource = response.answers[SOURCE_QUESTION];
  const optionsInOrder = sourceOptions(input.sources.length);

  validateChoice(intent, INTENT_OPTIONS);
  validateChoice(bestSource, optionsInOrder);

  const canonicalIndex = new Map(optionsInOrder.map((option, index) => [option, index]));
  const rankedSources = Object.entries(bestSource.probabilities)
    .sort(([left, leftProbability], [right, rightProbability]) =>
      rightProbability - leftProbability ||
      canonicalIndex.get(left)! - canonicalIndex.get(right)!
    )
    .map(([label, probability]) => label === NONE_OPTION
      ? ({ kind: "none" as const, probability })
      : ({
          kind: "source" as const,
          sourceIndex: Number(label.slice("source_".length)),
          probability,
        }));

  return {
    intent: intent.choice as JevRecallIntent,
    intentConfidence: intent.confidence,
    rankedSources,
    sufficiency: response.answers[SUFFICIENCY_QUESTION].noul,
    model: response.model,
    provider: response.provider,
    usage: response.usage,
  };
}

export function isJevRecallShadowEnabled(env: Env = process.env): boolean {
  return env.CAPTURE_JEV_RECALL_SHADOW === "1" && Boolean(env.OPENROUTER_API_KEY);
}

function probabilityBucket(value: number): number {
  return Math.min(HISTOGRAM_BUCKETS - 1, Math.floor(value * HISTOGRAM_BUCKETS));
}

function citedSourceIndexes(input: JevRecallShadowInput): Set<number> {
  const indexes = new Map(input.sources.map((source, index) => [source.id, index]));
  const cited = new Set<number>();
  input.authoritativeAnswer.claims.forEach((claim) => {
    claim.citations.forEach((citation) => {
      const index = indexes.get(citation.sourceId);
      if (index !== undefined) cited.add(index);
    });
  });
  return cited;
}

/**
 * Schedule a disabled-by-default observation through Next's post-response
 * primitive. Every failure is contained; the cited Recall result is immutable.
 */
export function scheduleJevRecallShadow(
  input: JevRecallShadowInput,
  options: {
    env?: Env;
    fetcher?: Fetcher;
    schedule?: Scheduler;
  } = {}
): boolean {
  const env = options.env ?? process.env;
  if (
    !isJevRecallShadowEnabled(env) ||
    !input.question.trim() ||
    !input.sources.length ||
    input.sources.length > MAX_SOURCES
  ) {
    return false;
  }

  const apiKey = env.OPENROUTER_API_KEY!;
  const schedule = options.schedule ?? after;
  const task = async () => {
    try {
      const result = await runJevRecallShadow(input, {
        apiKey,
        fetcher: options.fetcher,
      });
      const citedIndexes = citedSourceIndexes(input);
      const top = result.rankedSources[0];
      const bestCitedSourceRank = result.rankedSources.findIndex(
        (rank) => rank.kind === "source" && citedIndexes.has(rank.sourceIndex)
      );
      const proseIntent = result.intent === "answer_fact" || result.intent === "synthesize";

      console.info("[capture] jev recall shadow", {
        authoritativeStatus: input.authoritativeAnswer.status,
        ...(bestCitedSourceRank < 0 ? {} : { bestCitedSourceRank: bestCitedSourceRank + 1 }),
        citedSourceCount: citedIndexes.size,
        inputTokens: result.usage.inputTokens,
        intent: result.intent,
        intentConfidenceBucket: probabilityBucket(result.intentConfidence),
        potentialAvoidedProseCallByIntent: !proseIntent,
        sourceCount: input.sources.length,
        sufficiencyBucket: probabilityBucket(result.sufficiency),
        topSource: top.kind,
        ...(top.kind === "source"
          ? {
              topSourceCited: citedIndexes.has(top.sourceIndex),
              topSourceIndex: top.sourceIndex,
            }
          : {}),
      });
    } catch (error) {
      console.warn(
        "[capture] jev recall shadow failed",
        safeOpenRouterDecisionsFailure(error)
      );
    }
  };

  try {
    schedule(task);
    return true;
  } catch (error) {
    console.warn(
      "[capture] jev recall shadow failed",
      safeOpenRouterDecisionsFailure(error)
    );
    return false;
  }
}
