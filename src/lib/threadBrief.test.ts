import { describe, expect, it } from "vitest";
import type { Thread } from "./model";
import { brief, briefLength, semanticSiblingNames, threadBriefs, latestNotes } from "./threadBrief";

describe("what the sorter is told about each thread", () => {
  it("spends the budget across the board, within bounds", () => {
    expect(briefLength(1)).toBe(700);
    expect(briefLength(17)).toBeGreaterThan(200);
    expect(briefLength(200)).toBe(200);
  });

  it("stops at a sentence rather than mid-clause", () => {
    const s = "Seats are simpler to explain. Usage feels fairer to small teams and nobody has decided.";
    expect(brief(s, 40)).toBe("Seats are simpler to explain.");
    /* No sentence end early enough — fall back to an honest ellipsis. */
    expect(brief("a".repeat(80) + ". tail", 40)).toMatch(/…$/);
  });

  it("excludes a mechanical temporary Thread from semantic routing candidates until rename", () => {
    const temporary: Thread = {
      id: "temporary",
      name: "Temporary — Plan the Capture release without",
      temporaryName: true,
      summary: "",
      frags: [{ id: "first", at: 1, text: "Plan the Capture release without asking a model" }],
    };
    expect(threadBriefs([temporary])).toEqual([]);
    expect(threadBriefs([{ ...temporary, name: "Release planning", temporaryName: undefined }]))
      .toEqual([{ id: "temporary", name: "Release planning", about: "" }]);
  });

  it("keeps each thread's latest note apart from its description, without headings", () => {
    const thread: Thread = {
      id: "writing", name: "Writing", summary: "Article ideas for X.",
      frags: [
        { id: "old", at: 1, text: "An older idea about pricing." },
        { id: "new", at: 5, text: "### Article ideas overview\n\nOkay, another article idea. " + "It keeps going about founders and demos. ".repeat(8) },
        { id: "unsorted", at: 9, text: "Not placed yet.", unsorted: true },
      ],
    };
    expect(threadBriefs([thread])[0].about).toBe("Article ideas for X.");
    const { writing } = latestNotes([thread, { id: "empty", name: "Empty", summary: "", frags: [] }]);
    expect(writing.startsWith("Okay, another article idea.")).toBe(true);
    expect(writing.length).toBeLessThanOrEqual(161);
    expect(Object.keys(latestNotes([thread, { id: "empty", name: "Empty", summary: "", frags: [] }]))).toEqual(["writing"]);
  });

  it("excludes temporary and target Threads from summary sibling context until rename", () => {
    const target: Thread = { id: "target", name: "Target", summary: "", frags: [] };
    const temporary: Thread = {
      id: "temporary", name: "Temporary — private display label", temporaryName: true,
      summary: "", frags: [],
    };
    expect(semanticSiblingNames([target, temporary], "target")).toEqual([]);
    expect(semanticSiblingNames([
      target,
      { ...temporary, name: "Named normally", temporaryName: undefined },
    ], "target")).toEqual(["Named normally"]);
  });

  it("carries far more than the old sentence and a half", () => {
    const long = "x".repeat(2000);
    const threads = [{ id: "t", name: "T", summary: long, frags: [] }] as Thread[];
    expect(threadBriefs(threads)[0].about.length).toBeGreaterThan(160);
  });
});

it("routes a thread the person named even when it was flagged temporary, and keeps a placeholder out", async () => {
  const { threadBriefs } = await import("./threadBrief");
  const named = { id: "ml", name: "Mountain Lion", temporaryName: true, summary: "", frags: [{ id: "f", at: 1, text: "For Mountain Lion" }] };
  const placeholder = { id: "tmp", name: "Temporary — For Mountain Lion I", temporaryName: true, summary: "", frags: [{ id: "g", at: 1, text: "x" }] };
  expect(threadBriefs([named, placeholder]).map((brief) => brief.id)).toEqual(["ml"]);
});
