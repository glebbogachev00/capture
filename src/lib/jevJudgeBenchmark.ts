export type JevJudgeBenchmarkFixture = {
  batchId: string;
  id: string;
  expectedKeep: boolean;
  candidate: {
    kind: string;
    source: string;
    target: string;
    targetContext?: string;
  };
};

export type JevJudgeBenchmarkScore = {
  id: string;
  noul: number;
};

export type JevJudgeBenchmarkMetrics = {
  threshold: number;
  candidateCount: number;
  positiveCount: number;
  falseRejectionCount: number;
  falseRejectionRate: number;
  correctCount: number;
  accuracy: number;
  batchCount: number;
  potentialEliminatedCallCount: number;
  potentialGenerativeCallEliminationRate: number;
  unsafeEliminatedCallCount: number;
};

function uniqueMap<T extends { id: string }>(values: T[], label: string): Map<string, T> {
  const map = new Map<string, T>();
  values.forEach((value) => {
    if (map.has(value.id)) throw new Error(`duplicate ${label} id`);
    map.set(value.id, value);
  });
  return map;
}

/**
 * Evaluate a hypothetical threshold only. Nothing in production imports this
 * module, and the harness intentionally does not choose or activate a cutoff.
 */
export function evaluateJevJudgeThreshold(
  fixtures: JevJudgeBenchmarkFixture[],
  scores: JevJudgeBenchmarkScore[],
  threshold: number
): JevJudgeBenchmarkMetrics {
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new Error("threshold must be between zero and one");
  }
  const fixtureById = uniqueMap(fixtures, "fixture");
  const scoreById = uniqueMap(scores, "score");
  if (fixtureById.size !== scoreById.size) throw new Error("incomplete score set");
  for (const score of scoreById.values()) {
    if (!fixtureById.has(score.id)) throw new Error("score for unknown fixture");
    if (!Number.isFinite(score.noul) || score.noul < 0 || score.noul > 1) {
      throw new Error("noul score must be between zero and one");
    }
  }

  let positiveCount = 0;
  let falseRejectionCount = 0;
  let correctCount = 0;
  const batches = new Map<string, { predictedKeep: boolean; expectedKeep: boolean }[]>();

  fixtures.forEach((fixture) => {
    const score = scoreById.get(fixture.id);
    if (!score) throw new Error("missing score");
    const predictedKeep = score.noul >= threshold;
    if (fixture.expectedKeep) positiveCount += 1;
    if (fixture.expectedKeep && !predictedKeep) falseRejectionCount += 1;
    if (fixture.expectedKeep === predictedKeep) correctCount += 1;
    const batch = batches.get(fixture.batchId) ?? [];
    batch.push({ predictedKeep, expectedKeep: fixture.expectedKeep });
    batches.set(fixture.batchId, batch);
  });

  const eliminated = [...batches.values()].filter((batch) =>
    batch.every(({ predictedKeep }) => !predictedKeep)
  );
  const unsafeEliminatedCallCount = eliminated.filter((batch) =>
    batch.some(({ expectedKeep }) => expectedKeep)
  ).length;

  return {
    threshold,
    candidateCount: fixtures.length,
    positiveCount,
    falseRejectionCount,
    falseRejectionRate: positiveCount ? falseRejectionCount / positiveCount : 0,
    correctCount,
    accuracy: fixtures.length ? correctCount / fixtures.length : 0,
    batchCount: batches.size,
    potentialEliminatedCallCount: eliminated.length,
    potentialGenerativeCallEliminationRate: batches.size ? eliminated.length / batches.size : 0,
    unsafeEliminatedCallCount,
  };
}

export function sweepJevJudgeThresholds(
  fixtures: JevJudgeBenchmarkFixture[],
  scores: JevJudgeBenchmarkScore[]
): JevJudgeBenchmarkMetrics[] {
  return Array.from({ length: 101 }, (_, index) =>
    evaluateJevJudgeThreshold(fixtures, scores, index / 100)
  );
}
