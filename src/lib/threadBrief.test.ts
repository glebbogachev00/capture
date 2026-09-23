import { describe, expect, it } from "vitest";
import type { Thread } from "./model";
import { brief, briefLength, threadBriefs } from "./threadBrief";

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

  it("carries far more than the old sentence and a half", () => {
    const long = "x".repeat(2000);
    const threads = [{ id: "t", name: "T", summary: long, frags: [] }] as Thread[];
    expect(threadBriefs(threads)[0].about.length).toBeGreaterThan(160);
  });

  it("describes a new thread from its settled material before its summary arrives", () => {
    const threads = [{
      id: "capture-article",
      name: "Capture article",
      summary: "",
      frags: [
        { id: "first", at: 1, text: "Outline an article about turning rough thoughts into useful material." },
        { id: "second", at: 2, text: "The opening should feel practical and personal." },
      ],
    }] as Thread[];

    expect(threadBriefs(threads)[0].about).toContain("turning rough thoughts into useful material");
    expect(threadBriefs(threads)[0].about).toContain("practical and personal");
  });

  it("never exposes waiting-to-sort fragments as routing context", () => {
    const threads = [{
      id: "capture",
      name: "Capture",
      summary: "Product thinking",
      frags: [
        { id: "settled", at: 1, text: "Keep rough thoughts useful." },
        { id: "waiting", at: 2, text: "private pending words", unsorted: true },
      ],
    }] as Thread[];

    const about = threadBriefs(threads)[0].about;
    expect(about).toContain("Keep rough thoughts useful");
    expect(about).not.toContain("private pending words");
    expect(about.length).toBeLessThanOrEqual(briefLength(1) + 1);
  });
});
