import { describe, expect, it } from "vitest";

import fixtures from "./fixtures/jevJudgeSynthetic.json";
import {
  evaluateJevJudgeThreshold,
  sweepJevJudgeThresholds,
  type JevJudgeBenchmarkFixture,
} from "./jevJudgeBenchmark";

const scored = [
  { id: "pricing-related", noul: 0.91 },
  { id: "vet-unrelated", noul: 0.08 },
  { id: "domain-duplicate", noul: 0.82 },
  { id: "demo-same-topic-not-duplicate", noul: 0.31 },
  { id: "morning-word-overlap", noul: 0.17 },
  { id: "publish-word-overlap", noul: 0.12 },
  { id: "portfolio-lesson-overlap", noul: 0.06 },
  { id: "coffee-code-overlap", noul: 0.23 },
];

const synthetic = fixtures as JevJudgeBenchmarkFixture[];

describe("Jev judge synthetic benchmark harness", () => {
  it("measures false rejection, accuracy, and potential generative-call elimination", () => {
    expect(evaluateJevJudgeThreshold(synthetic, scored, 0.5)).toEqual({
      threshold: 0.5,
      candidateCount: 8,
      positiveCount: 2,
      falseRejectionCount: 0,
      falseRejectionRate: 0,
      correctCount: 8,
      accuracy: 1,
      batchCount: 4,
      potentialEliminatedCallCount: 2,
      potentialGenerativeCallEliminationRate: 0.5,
      unsafeEliminatedCallCount: 0,
    });
  });

  it("makes an unsafe threshold visible rather than calling it calibrated", () => {
    const metrics = evaluateJevJudgeThreshold(synthetic, scored, 0.9);
    expect(metrics.falseRejectionCount).toBe(1);
    expect(metrics.falseRejectionRate).toBe(0.5);
    expect(metrics.unsafeEliminatedCallCount).toBe(1);
  });

  it("sweeps candidate thresholds without selecting or activating one", () => {
    const sweep = sweepJevJudgeThresholds(synthetic, scored);
    expect(sweep[0].threshold).toBe(0);
    expect(sweep.at(-1)?.threshold).toBe(1);
    expect(sweep).toHaveLength(101);
  });

  it("rejects missing, duplicate, or out-of-range observations", () => {
    expect(() => evaluateJevJudgeThreshold(synthetic, scored.slice(1), 0.5)).toThrow();
    expect(() => evaluateJevJudgeThreshold(synthetic, [...scored, scored[0]], 0.5)).toThrow();
    expect(() => evaluateJevJudgeThreshold(synthetic, scored.map((score, index) =>
      index === 0 ? { ...score, noul: 2 } : score
    ), 0.5)).toThrow();
  });
});
