import { describe, expect, it } from "vitest";
import { applyRules, parseRule } from "./ruleMatch";

describe("learned rules, applied in code", () => {
  it("reads the three rule shapes the board writes", () => {
    expect(parseRule('Captures about "hallway paint" are an action, not a thread')).toEqual({
      subject: ["hallway", "paint"],
      kind: "action",
    });
    expect(parseRule('Captures about "drafts building" are a thread')).toEqual({
      subject: ["drafts", "building"],
      kind: "thread",
    });
    expect(parseRule('Captures about "pricing model" belong in "Pricing model considerations"')).toEqual({
      subject: ["pricing", "model"],
      kind: "thread",
      home: "Pricing model considerations",
    });
    expect(parseRule("be nicer")).toBeNull();
  });

  it("decides the kind when the capture holds every subject word", () => {
    const rules = ['Captures about "hallway paint" are an action, not a thread'];
    expect(applyRules("thinking about the hallway paint again, a warmer white", rules, [])).toMatchObject({
      kind: "action",
    });
    /* One word of two is not the subject. */
    expect(applyRules("the hallway light is flickering", rules, [])).toBeNull();
  });

  it("a refile rule names the home, only while that thread exists", () => {
    const rules = ['Captures about "pricing model" belong in "Pricing model considerations"'];
    const threads = [{ id: "t1", name: "Pricing model considerations" }];
    expect(applyRules("another pricing model thought: seats", rules, threads)).toEqual({
      kind: "thread",
      threadId: "t1",
      rule: rules[0],
    });
    expect(applyRules("another pricing model thought: seats", rules, [])).toBeNull();
  });

  it("the newest rule wins", () => {
    const rules = [
      'Captures about "hallway paint" are a thread, not an action',
      'Captures about "hallway paint" are an action, not a thread',
    ];
    expect(applyRules("hallway paint, warmer white", rules, [])?.kind).toBe("thread");
  });
});
