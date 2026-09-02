import { describe, expect, it } from "vitest";
import { organizeCorrection } from "./organizeOps";
import type { OrganizeProposal } from "./organize";

const p = (over: Partial<OrganizeProposal>): OrganizeProposal =>
  ({
    id: "p1",
    kind: "move_fragment",
    confidence: "high",
    sourceId: "s",
    targetId: "t",
    targetName: "Pricing",
    reason: "",
    ...over,
  }) as OrganizeProposal;

describe("organizeCorrection — what an approved tidy teaches", () => {
  it("names the destination in the rule, so it generalises", () => {
    /* The rule is injected into later prompts as a tendency, so it has to
       read as an instruction about where things go — not as a note about
       one event that happened once. */
    const note = organizeCorrection(p({ kind: "move_fragment" }));
    expect(note?.rule).toBe('Move notes into "Pricing"');
    expect(note?.accepted).toBe(true);
  });

  it("treats an action fold and a note move as different lessons", () => {
    expect(organizeCorrection(p({ kind: "fold_action" }))?.rule).toBe(
      'Move actions into "Pricing"'
    );
    expect(organizeCorrection(p({ kind: "move_fragment" }))?.rule).toBe(
      'Move notes into "Pricing"'
    );
  });

  it("gives a merge the same destination lesson as a move", () => {
    /* Both end with the note living in the target thread; the sorter should
       learn the destination either way. */
    expect(organizeCorrection(p({ kind: "merge_fragments" }))?.rule).toBe(
      'Move notes into "Pricing"'
    );
  });

  it("records a split without a rule — it names no destination", () => {
    const note = organizeCorrection(p({ kind: "split_fragment" }));
    expect(note?.context).toContain("split a note out of");
    expect(note?.rule).toBeUndefined();
  });

  it("teaches the same thing whether a duplicate was an action or a note", () => {
    const a = organizeCorrection(p({ kind: "dup_action" }));
    const f = organizeCorrection(p({ kind: "dup_fragment" }));
    expect(a).toEqual(f);
    expect(a?.rule).toBe('Drop duplicates of "Pricing"');
  });

  describe("the three that must teach nothing", () => {
    /* Feeding these to the learning loop would teach the sorter lessons
       that were never about sorting. */
    it.each(["looks_done", "let_go", "revisit_intention"] as const)(
      "%s writes no correction",
      (kind) => {
        expect(organizeCorrection(p({ kind }))).toBeNull();
      }
    );
  });
});
