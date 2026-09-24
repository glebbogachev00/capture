import { describe, expect, it } from "vitest";
import type { SortResult } from "./boardOps";
import type { SourceSegment } from "./sortInterpretation";
import { reconcileSortDates } from "./sortDates";

function actions(rows: Array<{ source: string; due: string | null }>): SortResult {
  return {
    clean: rows.map((row) => row.source).join(" "),
    kind: "action",
    title: "Tasks",
    actions: rows.map((_, index) => `Task ${index + 1}`),
    actionMeta: rows.map((row, index) => ({
      text: `Task ${index + 1}`,
      source: row.source,
      shelfLife: "days",
      due: row.due,
      thinkingIndex: null,
    })),
    due: rows.length === 1 ? rows[0].due : null,
  };
}

const reconcile = (
  result: SortResult,
  localDate = "2026-09-24",
  sourceSegments: SourceSegment[] = [],
) => reconcileSortDates(result, localDate, sourceSegments);

describe("reconcileSortDates", () => {
  it("corrects only dates recognized in each action's own source", () => {
    const result = actions([
      { source: "Audit onboarding before Friday.", due: "2026-09-27" },
      { source: "Rewrite the copy tomorrow.", due: "2026-09-30" },
      { source: "Schedule the email.", due: "2026-10-08" },
    ]);

    expect(reconcile(result).actionMeta?.map((row) => row.due)).toEqual([
      "2026-09-25",
      "2026-09-25",
      "2026-10-08",
    ]);
  });

  it("resolves today, tomorrow, and an upcoming weekday from the client date", () => {
    expect(reconcile(actions([{ source: "Send it today.", due: "2026-09-25" }])).due)
      .toBe("2026-09-24");
    expect(reconcile(actions([{ source: "Send it tomorrow.", due: "2026-09-30" }])).due)
      .toBe("2026-09-25");
    expect(reconcile(actions([{ source: "Send it Monday.", due: "2026-10-01" }])).due)
      .toBe("2026-09-28");
  });

  it("resolves ordinal day deadlines across month boundaries", () => {
    const result = reconcile(
      actions([{ source: "Send it by the 3rd.", due: "2026-09-03" }]),
    );
    expect(result.due).toBe("2026-10-03");
  });

  it("preserves a textual absolute October 1 deadline beside a relative Friday deadline", () => {
    const result = actions([
      { source: "Call Maya Friday.", due: "2026-09-27" },
      { source: "Send the proposal on October 1.", due: "2026-10-01" },
    ]);

    expect(reconcile(result).actionMeta?.map((row) => row.due)).toEqual([
      "2026-09-25",
      "2026-10-01",
    ]);
  });

  it("never borrows one recognized date from raw text for another action", () => {
    const result = actions([
      { source: "Call Maya Friday.", due: "2026-09-27" },
      { source: "Send the proposal.", due: "2026-10-01" },
    ]);

    expect(reconcile(result).actionMeta?.map((row) => row.due)).toEqual([
      "2026-09-25",
      "2026-10-01",
    ]);
  });

  it("applies deterministic shared date context only to explicitly declared action owners", () => {
    const result = actions([
      { source: "audit onboarding", due: "2026-09-27" },
      { source: "rewrite the copy", due: "2026-09-27" },
      { source: "schedule the email", due: "2026-10-01" },
    ]);
    const sourceSegments: SourceSegment[] = [
      { text: "Before Friday, ", role: "context", ownerIndex: null, actionOwnerIndexes: [0, 1] },
      { text: "audit onboarding", role: "action", ownerIndex: 0 },
      { text: ", ", role: "context", ownerIndex: null },
      { text: "rewrite the copy", role: "action", ownerIndex: 1 },
      { text: ", and ", role: "context", ownerIndex: null },
      { text: "schedule the email", role: "action", ownerIndex: 2 },
      { text: ".", role: "context", ownerIndex: null },
    ];

    expect(reconcile(result, "2026-09-24", sourceSegments).actionMeta?.map((row) => row.due)).toEqual([
      "2026-09-25",
      "2026-09-25",
      "2026-10-01",
    ]);
  });

  it("preserves provider dates when shared context has no explicit owners", () => {
    const result = actions([
      { source: "audit onboarding", due: "2026-09-27" },
      { source: "rewrite the copy", due: "2026-10-01" },
    ]);
    const sourceSegments: SourceSegment[] = [
      { text: "Before Friday, ", role: "context", ownerIndex: null },
      { text: "audit onboarding", role: "action", ownerIndex: 0 },
      { text: " and ", role: "context", ownerIndex: null },
      { text: "rewrite the copy", role: "action", ownerIndex: 1 },
    ];

    expect(reconcile(result, "2026-09-24", sourceSegments).actionMeta?.map((row) => row.due)).toEqual([
      "2026-09-27",
      "2026-10-01",
    ]);
  });

  it("preserves multiple distinct action deadlines", () => {
    const result = actions([
      { source: "Call Maya Friday.", due: "2026-09-27" },
      { source: "Buy milk tomorrow.", due: "2026-09-30" },
      { source: "Send the report on October 1.", due: "2026-10-01" },
    ]);

    expect(reconcile(result).actionMeta?.map((row) => row.due)).toEqual([
      "2026-09-25",
      "2026-09-25",
      "2026-10-01",
    ]);
  });

  it("leaves absolute and absent dates unchanged", () => {
    const absolute = actions([{ source: "Send it by 2026-10-15.", due: "2026-10-15" }]);
    expect(reconcile(absolute)).toEqual(absolute);
    const textual = actions([{ source: "Send it on October 1.", due: "2026-10-01" }]);
    expect(reconcile(textual)).toEqual(textual);
    const absent = actions([{ source: "Send the draft.", due: null }]);
    expect(reconcile(absent)).toEqual(absent);
  });

  it("does not invent a deadline from a subject name when the provider found none", () => {
    const title = actions([{ source: "Review Friday Night Lights.", due: null }]);
    expect(reconcile(title)).toEqual(title);
  });

  it("keeps an explicit same-day Friday deadline on Friday", () => {
    const result = reconcile(
      actions([{ source: "Send it by Friday.", due: "2026-10-02" }]),
      "2026-09-25",
    );
    expect(result.due).toBe("2026-09-25");
  });

  it.each(["next", "coming", "following"])(
    "preserves the provider-owned date for ambiguous %s-weekday phrasing",
    (modifier) => {
      const source = `Send it ${modifier} Friday.`;
      const result = reconcile(
        actions([{ source, due: "2026-10-02" }]),
        "2026-09-25",
      );
      expect(result.due).toBe("2026-10-02");
    },
  );

  it("does not let a deterministic date on another action overwrite an ambiguous weekday", () => {
    const result = actions([
      { source: "Send the draft next Friday.", due: "2026-10-02" },
      { source: "Buy milk today.", due: "2026-09-30" },
    ]);

    expect(reconcile(result).actionMeta?.map((row) => row.due)).toEqual([
      "2026-10-02",
      "2026-09-24",
    ]);
  });
});
