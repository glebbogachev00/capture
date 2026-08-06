import { describe, expect, it } from "vitest";
import {
  countAssistantQuestions,
  findMarker,
  hydrateDistill,
  markerHold,
  resolveSettled,
  EMPTY_DISTILL,
} from "./distill";

describe("findMarker", () => {
  it("finds nothing in a plain reply", () => {
    expect(findMarker("Nothing to capture here — just a hello.")).toBeNull();
  });

  it("finds a trailing [ready]", () => {
    const s = "I'd file this as a thread.\n[ready]";
    expect(findMarker(s)).toEqual({ kind: "ready", at: s.indexOf("[ready]") });
  });

  it("finds a trailing [nothing]", () => {
    const s = "Just a hello.\n[nothing]";
    expect(findMarker(s)).toEqual({
      kind: "nothing",
      at: s.indexOf("[nothing]"),
    });
  });

  it("reports the earliest marker when both appear", () => {
    // A model misfire: text that carries both. The first one wins.
    expect(findMarker("[nothing] not [ready]")).toEqual({
      kind: "nothing",
      at: 0,
    });
  });

  it("catches a marker split at a chunk boundary via the held suffix", () => {
    // First chunk ends with "[noth" — held by markerHold; prepend to the
    // next chunk so the full marker is visible to findMarker.
    expect(markerHold("Just a hello.\n[noth")).toBe(5);
    const full = "Just a hello.\n[noth" + "ing]";
    expect(findMarker(full)).toEqual({
      kind: "nothing",
      at: full.indexOf("[nothing]"),
    });
  });
});

describe("markerHold", () => {
  it("holds the longest suffix that could begin a marker", () => {
    expect(markerHold("just a hello\n[rea")).toBe(4); // [rea → [ready
    expect(markerHold("just a hello\n[noth")).toBe(5); // [noth → [nothing
  });

  it("holds nothing when no suffix could begin a marker", () => {
    expect(markerHold("ordinary text")).toBe(0);
    expect(markerHold("x]")).toBe(0); // a lone close bracket is not a start
  });

  it("holds a complete marker too — findMarker catches it first", () => {
    // A full marker is also a suffix that could begin a marker, so it is
    // held. Harmless: the client runs findMarker on the same chunk first,
    // which finds the complete marker and never reaches the hold.
    expect(markerHold("a [ready]")).toBe(7);
  });
});

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
