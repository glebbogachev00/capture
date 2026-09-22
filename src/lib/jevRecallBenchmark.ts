import type { JevRecallIntent } from "./jevRecallShadow";

export type JevRecallBenchmarkFixture = {
  caseId: string;
  question: string;
  sources: { label: string; excerpt: string }[];
  expectedIntent: JevRecallIntent;
  expectedSourceRanking: string[];
  expectedSufficient: boolean;
  expectedProseCall: boolean;
};

export type JevRecallBenchmarkObservation = {
  caseId: string;
  intent: JevRecallIntent;
  sourceRanking: string[];
  sufficient: boolean;
  wouldInvokeProse: boolean;
};

export type JevRecallBenchmarkMetrics = {
  caseCount: number;
  intentAgreementCount: number;
  intentAgreementRate: number;
  sourcePairCount: number;
  sourceRankAgreementCount: number;
  sourceRankAgreementRate: number;
  sufficiencyAgreementCount: number;
  sufficiencyAgreementRate: number;
  expectedProseCallCount: number;
  potentialAvoidedProseCallCount: number;
  potentialAvoidedProseCallRate: number;
  unsafeSuppressionCount: number;
  unsafeShareOfSuppressedCalls: number;
  falseNegativeRate: number;
};

function uniqueMap<T extends { caseId: string }>(values: T[], label: string): Map<string, T> {
  const mapped = new Map<string, T>();
  values.forEach((value) => {
    if (mapped.has(value.caseId)) throw new Error(`duplicate ${label} case id`);
    mapped.set(value.caseId, value);
  });
  return mapped;
}

function assertUniqueCompleteRanking(
  expected: string[],
  observed: string[]
): void {
  const expectedSet = new Set(expected);
  const observedSet = new Set(observed);
  if (
    expected.length !== expectedSet.size ||
    observed.length !== observedSet.size ||
    expectedSet.size !== observedSet.size ||
    [...expectedSet].some((label) => !observedSet.has(label))
  ) {
    throw new Error("source rankings must contain the same unique labels");
  }
}

/**
 * Score already-interpreted observations. The harness deliberately accepts a
 * boolean sufficiency/routing observation rather than inventing a probability
 * threshold, and it has no production import path.
 */
export function evaluateJevRecallObservations(
  fixtures: JevRecallBenchmarkFixture[],
  observations: JevRecallBenchmarkObservation[]
): JevRecallBenchmarkMetrics {
  const fixtureById = uniqueMap(fixtures, "fixture");
  const observationById = uniqueMap(observations, "observation");
  if (fixtureById.size !== observationById.size) {
    throw new Error("incomplete observation set");
  }
  for (const caseId of observationById.keys()) {
    if (!fixtureById.has(caseId)) throw new Error("observation for unknown fixture");
  }

  let intentAgreementCount = 0;
  let sourcePairCount = 0;
  let sourceRankAgreementCount = 0;
  let sufficiencyAgreementCount = 0;
  let expectedProseCallCount = 0;
  let potentialAvoidedProseCallCount = 0;
  let unsafeSuppressionCount = 0;

  fixtures.forEach((fixture) => {
    const observation = observationById.get(fixture.caseId);
    if (!observation) throw new Error("missing observation");
    assertUniqueCompleteRanking(
      fixture.expectedSourceRanking,
      observation.sourceRanking
    );

    if (fixture.expectedIntent === observation.intent) intentAgreementCount += 1;
    if (fixture.expectedSufficient === observation.sufficient) {
      sufficiencyAgreementCount += 1;
    }
    if (fixture.expectedProseCall) expectedProseCallCount += 1;
    if (!observation.wouldInvokeProse) {
      potentialAvoidedProseCallCount += 1;
      if (fixture.expectedProseCall) unsafeSuppressionCount += 1;
    }

    const observedPosition = new Map(
      observation.sourceRanking.map((label, index) => [label, index])
    );
    for (let left = 0; left < fixture.expectedSourceRanking.length; left += 1) {
      for (let right = left + 1; right < fixture.expectedSourceRanking.length; right += 1) {
        sourcePairCount += 1;
        if (
          observedPosition.get(fixture.expectedSourceRanking[left])! <
          observedPosition.get(fixture.expectedSourceRanking[right])!
        ) {
          sourceRankAgreementCount += 1;
        }
      }
    }
  });

  const caseCount = fixtures.length;
  return {
    caseCount,
    intentAgreementCount,
    intentAgreementRate: caseCount ? intentAgreementCount / caseCount : 0,
    sourcePairCount,
    sourceRankAgreementCount,
    sourceRankAgreementRate: sourcePairCount
      ? sourceRankAgreementCount / sourcePairCount
      : 0,
    sufficiencyAgreementCount,
    sufficiencyAgreementRate: caseCount ? sufficiencyAgreementCount / caseCount : 0,
    expectedProseCallCount,
    potentialAvoidedProseCallCount,
    potentialAvoidedProseCallRate: caseCount
      ? potentialAvoidedProseCallCount / caseCount
      : 0,
    unsafeSuppressionCount,
    unsafeShareOfSuppressedCalls: potentialAvoidedProseCallCount
      ? unsafeSuppressionCount / potentialAvoidedProseCallCount
      : 0,
    falseNegativeRate: expectedProseCallCount
      ? unsafeSuppressionCount / expectedProseCallCount
      : 0,
  };
}
