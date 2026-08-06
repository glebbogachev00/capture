import { describe, expect, it } from "vitest";
import {
  countAssistantQuestions,
  hydrateDistill,
  resolveSettled,
  EMPTY_DISTILL,
} from "./distill";

describe("resolveSettled", () => {
  it("reclassifies an action with no items as a thread", () => {
    const out = resolveSettled({
      kind: "action",
      clean: "a long exploration with nothing to do",
      actions: [],
    });
    expect(out.kind).toBe("thread");
    expect(out.actions).toEqual([]);
  });

  it("reclassifies an action whose only items are blank", () => {
    const out = resolveSettled({ kind: "action", actions: ["", "   "] });
    expect(out.kind).toBe("thread");
  });

  it("keeps a real action and trims its items", () => {
    const out = resolveSettled({
      kind: "action",
      actions: ["  Call the vet  ", "", "Buy cat food"],
    });
    expect(out.kind).toBe("action");
    expect(out.actions).toEqual(["Call the vet", "Buy cat food"]);
  });

  it("never touches a thread or an intention", () => {
    expect(resolveSettled({ kind: "thread", actions: [] }).kind).toBe("thread");
    expect(resolveSettled({ kind: "intention", actions: [] }).kind).toBe(
      "intention"
    );
  });
});

describe("countAssistantQuestions", () => {
  it("counts nothing on an empty transcript", () => {
    expect(countAssistantQuestions([])).toBe(0);
  });

  it("counts an assistant turn that ends with a question", () => {
    expect(
      countAssistantQuestions([
        { role: "user", text: "I'm stuck on my job." },
        { role: "assistant", text: "Is it the money or the work?" },
      ])
    ).toBe(1);
  });

  it("counts two questions across a longer conversation", () => {
    expect(
      countAssistantQuestions([
        { role: "user", text: "Idea is fuzzy." },
        { role: "assistant", text: "Is it a product or a project?" },
        { role: "user", text: "A product." },
        { role: "assistant", text: "Who is it for?" },
      ])
    ).toBe(2);
  });

  it("survives a trailing-space edge", () => {
    expect(
      countAssistantQuestions([
        { role: "assistant", text: "Does that match?  " },
      ])
    ).toBe(1);
  });

  it("ignores user turns even when they end with a question", () => {
    expect(
      countAssistantQuestions([
        { role: "user", text: "Should I leave my job?" },
        { role: "assistant", text: "That's the question you're asking yourself." },
      ])
    ).toBe(0);
  });

  it("ignores an assistant reply that ends in a period, however tentative", () => {
    // A mid-sentence question mark is not a question turn: the budget counts
    // the turn, not the punctuation inside it.
    expect(
      countAssistantQuestions([
        { role: "assistant", text: "Maybe it's the money. Hard to say." },
      ])
    ).toBe(0);
  });

  it("ignores empty or whitespace-only turns", () => {
    expect(
      countAssistantQuestions([
        { role: "assistant", text: "" },
        { role: "assistant", text: "   " },
      ])
    ).toBe(0);
  });
});

describe("hydrateDistill", () => {
  it("returns the empty session for missing data", () => {
    expect(hydrateDistill(null)).toEqual(EMPTY_DISTILL);
    expect(hydrateDistill(undefined)).toEqual(EMPTY_DISTILL);
  });

  it("returns the empty session for malformed JSON", () => {
    expect(hydrateDistill("not json")).toEqual(EMPTY_DISTILL);
  });

  it("drops malformed turns and keeps well-formed ones", () => {
    const raw = JSON.stringify({
      id: "s1",
      at: 5,
      turns: [
        { role: "user", text: "hello", at: 1 },
        { role: "weird", text: "drop me", at: 2 },
        { role: "assistant", text: "hi", at: 3 },
        { role: "user", text: 42, at: 4 },
      ],
    });
    const s = hydrateDistill(raw);
    expect(s.id).toBe("s1");
    expect(s.at).toBe(5);
    expect(s.turns).toEqual([
      { role: "user", text: "hello", at: 1 },
      { role: "assistant", text: "hi", at: 3 },
    ]);
  });
});
