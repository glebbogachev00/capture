import { describe, expect, it } from "vitest";

import fixtures from "./fixtures/jevRecallSynthetic.json";
import {
  evaluateJevRecallObservations,
  type JevRecallBenchmarkFixture,
  type JevRecallBenchmarkObservation,
} from "./jevRecallBenchmark";

const synthetic = fixtures as JevRecallBenchmarkFixture[];

const observations: JevRecallBenchmarkObservation[] = [
  {
    caseId: "direct-fact",
    intent: "answer_fact",
    sourceRanking: ["source_0", "source_1", "none"],
    sufficient: true,
    wouldInvokeProse: true,
  },
  {
    caseId: "multi-source-synthesis",
    intent: "answer_fact",
    sourceRanking: ["source_1", "source_0", "none"],
    sufficient: true,
    wouldInvokeProse: false,
  },
  {
    caseId: "navigation-only",
    intent: "find_notes",
    sourceRanking: ["source_0", "none"],
    sufficient: true,
    wouldInvokeProse: false,
  },
  {
    caseId: "no-support",
    intent: "answer_fact",
    sourceRanking: ["none", "source_0"],
    sufficient: true,
    wouldInvokeProse: false,
  },
];

describe("Jev Recall/Search synthetic benchmark harness", () => {
  it("measures intent, source-rank, and sufficiency agreement without choosing a threshold", () => {
    expect(evaluateJevRecallObservations(synthetic, observations)).toEqual({
      caseCount: 4,
      intentAgreementCount: 3,
      intentAgreementRate: 0.75,
      sourcePairCount: 8,
      sourceRankAgreementCount: 7,
      sourceRankAgreementRate: 0.875,
      sufficiencyAgreementCount: 3,
      sufficiencyAgreementRate: 0.75,
      expectedProseCallCount: 2,
      potentialAvoidedProseCallCount: 3,
      potentialAvoidedProseCallRate: 0.75,
      unsafeSuppressionCount: 1,
      unsafeShareOfSuppressedCalls: 1 / 3,
      falseNegativeRate: 1 / 2,
    });
  });

  it("counts a skipped answerable case as an unsafe suppression", () => {
    const metrics = evaluateJevRecallObservations(synthetic, observations);
    expect(metrics.expectedProseCallCount).toBe(2);
    expect(metrics.potentialAvoidedProseCallCount).toBe(3);
    expect(metrics.unsafeSuppressionCount).toBe(1);
    expect(metrics.unsafeShareOfSuppressedCalls).toBe(1 / 3);
    expect(metrics.falseNegativeRate).toBe(1 / 2);
  });

  it("exposes every count used as a denominator and returns finite zero rates for empty input", () => {
    const metrics = evaluateJevRecallObservations([], []);

    expect(metrics).toEqual({
      caseCount: 0,
      intentAgreementCount: 0,
      intentAgreementRate: 0,
      sourcePairCount: 0,
      sourceRankAgreementCount: 0,
      sourceRankAgreementRate: 0,
      sufficiencyAgreementCount: 0,
      sufficiencyAgreementRate: 0,
      expectedProseCallCount: 0,
      potentialAvoidedProseCallCount: 0,
      potentialAvoidedProseCallRate: 0,
      unsafeSuppressionCount: 0,
      unsafeShareOfSuppressedCalls: 0,
      falseNegativeRate: 0,
    });
    expect(Object.values(metrics).every(Number.isFinite)).toBe(true);
  });

  it("returns zero suppression rates when their denominators are zero in a nonempty run", () => {
    const fixture = synthetic.find(({ caseId }) => caseId === "navigation-only")!;
    const observation = observations.find(({ caseId }) => caseId === fixture.caseId)!;
    const metrics = evaluateJevRecallObservations(
      [fixture],
      [{ ...observation, wouldInvokeProse: true }]
    );

    expect(metrics.caseCount).toBe(1);
    expect(metrics.expectedProseCallCount).toBe(0);
    expect(metrics.potentialAvoidedProseCallCount).toBe(0);
    expect(metrics.unsafeShareOfSuppressedCalls).toBe(0);
    expect(metrics.falseNegativeRate).toBe(0);
    expect(Object.values(metrics).every(Number.isFinite)).toBe(true);
  });

  it("keeps fixtures synthetic and opaque", () => {
    expect(synthetic.every((fixture) => fixture.sources.every((source, index) =>
      source.label === `source_${index}`
    ))).toBe(true);
    expect(JSON.stringify(synthetic)).not.toMatch(/accountId|sessionId|targetId|fragId/);
  });

  it("rejects incomplete, duplicate, unknown, or incomparable observations", () => {
    expect(() => evaluateJevRecallObservations(synthetic, observations.slice(1))).toThrow();
    expect(() => evaluateJevRecallObservations(synthetic, [...observations, observations[0]])).toThrow();
    expect(() => evaluateJevRecallObservations(synthetic, [
      ...observations.slice(0, -1),
      { ...observations.at(-1)!, caseId: "unknown" },
    ])).toThrow();
    expect(() => evaluateJevRecallObservations(synthetic, [
      { ...observations[0], sourceRanking: ["source_0", "none"] },
      ...observations.slice(1),
    ])).toThrow();
  });
});
