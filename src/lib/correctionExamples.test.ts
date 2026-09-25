import { describe, expect, it } from "vitest";
import type { CorrectionEntry } from "./ledger";
import { CORRECTION_EXAMPLES_CAP, deriveCorrectionExamples } from "./correctionExamples";

const threads = [{ id: "capture", name: "Capture" }, { id: "fitness", name: "Fitness" }];
const correction = (
  id: string,
  at: number,
  context: string,
  routing: NonNullable<CorrectionEntry["routing"]>,
): CorrectionEntry => ({
  id,
  at,
  proposalKind: "undone",
  accepted: true,
  context,
  routing,
});

describe("deriveCorrectionExamples", () => {
  it("keeps the corrected capture as semantic context without a phrase rule", () => {
    const entry = correction(
      "c1",
      10,
      "Need to tighten the handoff so Capture can ship sooner.",
      { kind: "thread", threadId: "capture", threadName: "Capture" },
    );

    expect(entry.rule).toBeUndefined();
    expect(deriveCorrectionExamples([entry], threads)).toEqual([{
      key: "correction:c1",
      text: '“Need to tighten the handoff so Capture can ship sooner.” → Capture',
      capture: entry.context,
      kind: "thread",
      threadId: "capture",
      threadName: "Capture",
      lastAt: 10,
    }]);
  });

  it("removes disabled, deleted, rejected, and stale-destination corrections from future context", () => {
    const enabled = correction("enabled", 4, "Capture release handoff", {
      kind: "thread", threadId: "capture", threadName: "Capture",
    });
    const disabled = correction("disabled", 3, "Another Capture example", {
      kind: "thread", threadId: "capture", threadName: "Capture",
    });
    const stale = correction("stale", 2, "Old destination", {
      kind: "thread", threadId: "gone", threadName: "Gone",
    });
    const rejected = { ...correction("rejected", 1, "Rejected", { kind: "action" }), accepted: false };

    expect(deriveCorrectionExamples(
      [enabled, disabled, stale, rejected],
      threads,
      ["correction:disabled"],
    ).map((example) => example.key)).toEqual(["correction:enabled"]);

    expect(deriveCorrectionExamples([disabled, stale, rejected], threads, ["correction:disabled"])).toEqual([]);
  });

  it("is newest-first and hard bounded", () => {
    const entries = Array.from({ length: CORRECTION_EXAMPLES_CAP + 3 }, (_, index) =>
      correction(`c${index}`, index, `Example ${index}`, { kind: "action" }),
    );
    const examples = deriveCorrectionExamples(entries, threads);
    expect(examples).toHaveLength(CORRECTION_EXAMPLES_CAP);
    expect(examples.map((example) => example.lastAt)).toEqual([7, 6, 5, 4, 3]);
  });

  it("does not backfill an invisible older correction when a visible correction is disabled", () => {
    const entries = Array.from({ length: CORRECTION_EXAMPLES_CAP + 1 }, (_, index) =>
      correction(`c${index + 1}`, 100 - index, `Example ${index + 1}`, { kind: "action" }),
    );

    expect(deriveCorrectionExamples(entries, threads, ["correction:c1"])
      .map((example) => example.key)).toEqual([
      "correction:c2",
      "correction:c3",
      "correction:c4",
      "correction:c5",
    ]);
  });

  it("bounds long Thread names before they enter the Sort request", () => {
    const longName = "A".repeat(101);
    const entry = correction("long-name", 10, "A corrected capture", {
      kind: "thread",
      threadId: "long-thread",
      threadName: longName,
    });

    const [example] = deriveCorrectionExamples([entry], [{ id: "long-thread", name: longName }]);
    expect(example.threadName).toHaveLength(100);
    expect(example.text).toBe(`“A corrected capture” → ${"A".repeat(100)}`);
  });
});
