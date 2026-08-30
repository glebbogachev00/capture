import { describe, expect, it } from "vitest";
import { EMPTY, type Board } from "./model";
import type { OrganizeProposal } from "./organize";
import { assemblePanel } from "./tidyPanel";

const prop = (id: string, over: Partial<OrganizeProposal> = {}): OrganizeProposal => ({
  id,
  kind: "fold_action",
  confidence: "high",
  verb: "Fold in",
  sourceId: "a1",
  sourceName: "Fix the mis-sorting of notes in Capture",
  targetId: "t1",
  targetName: "Bugs & Open Issues",
  reason: "both are notes about the sorting engine",
  score: 90,
  origin: "ai",
  ...over,
});

const board = { ...EMPTY } as Board;

describe("the Tidy panel, assembled once", () => {
  it("a dismissal holds against every source", () => {
    /* The inconsistency this file exists to end: one call site filtered
       dismissed rows from the model's proposals but not the judged ones,
       another the reverse — a waved-away row came back depending on which
       path repainted.
 
       Every proposal here has a DISTINCT identity on purpose. The first
       version of this test gave all three the same source and target, so
       mergeOrganize's dedup swallowed the undismissed row and the test
       passed with the filter deleted — an unfalsifiable test, caught only
       because falsification is mandatory. */
    const out = assemblePanel({
      board,
      ai: [
        prop("ai:1", { sourceId: "a1", targetId: "t1" }),
        prop("ai:2", { sourceId: "a2", targetId: "t2" }),
      ],
      judged: [
        prop("judged:1", { origin: "local", sourceId: "a3", targetId: "t3" }),
        prop("judged:2", { origin: "local", sourceId: "a4", targetId: "t4" }),
      ],
      dismissed: ["ai:1", "judged:1"],
    });
    const ids = out.map((p) => p.id);
    expect(ids).toContain("ai:2");
    expect(ids).toContain("judged:2");
    expect(ids).not.toContain("ai:1");
    expect(ids).not.toContain("judged:1");
  });

  it("model and judged rows merge without duplicating one claim", () => {
    /* Same fragment, found by both readers — mergeOrganize's dedup must
       still apply through the assembler. */
    const a = prop("ai:x", { sourceFragId: "f1" });
    const j = prop("judged:x", { sourceFragId: "f1", origin: "local" });
    const out = assemblePanel({ board, ai: [a], judged: [j], dismissed: [] });
    expect(out.filter((p) => p.sourceFragId === "f1")).toHaveLength(1);
  });

  it("an empty everything yields an empty panel, not a crash", () => {
    expect(assemblePanel({ board, ai: [], judged: [], dismissed: [] })).toEqual([]);
  });
});
