import { describe, expect, it } from "vitest";
import type { Thread } from "./model";
import { BRIEF_BUDGET, brief, promptThreadInventory, threadBriefs } from "./threadBrief";

describe("what the sorter is told about each thread", () => {

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

  it("keeps hundreds of long imported identities in one deterministic prompt inventory", () => {
    const threads = Array.from({ length: 120 }, (_, index) => ({
      id: `imported-${index}-${"i".repeat(300)}`,
      name: `${index === 119 ? "Late orchard" : `Thread ${index}`} ${"n".repeat(300)}`,
      belongs: "b".repeat(300),
      summary: "s".repeat(900),
      frags: [{ id: `f-${index}`, at: index, text: `original-${index} ${"o".repeat(900)}` }],
    })) as Thread[];
    const result = threadBriefs(threads);
    const prompt = promptThreadInventory(result);
    expect(result).toHaveLength(threads.length);
    expect(result.map((item) => item.id)).toEqual(threads.map((item) => item.id));
    expect(prompt.routes).toHaveLength(threads.length);
    expect(prompt.routes.at(-1)?.[0]).toBe("r3b");
    expect(prompt.routes.at(-1)?.[1]).toContain("Late orchard");
    expect(prompt.serialized.length).toBeLessThanOrEqual(BRIEF_BUDGET);
    expect(prompt.serialized).not.toContain(threads[0].id);
  });

  it("rejects inventories above the explicit route cap instead of silently omitting threads", () => {
    const threads = Array.from({ length: 257 }, (_, index) => ({
      id: `t-${index}`,
      name: `Thread ${index}`,
      summary: "",
      frags: [],
    })) as Thread[];
    expect(() => threadBriefs(threads)).toThrow(/too many thread candidates/i);
  });
});
