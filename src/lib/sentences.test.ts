import { describe, expect, it } from "vitest";
import { takeCompleteSentences } from "@/lib/sentences";

describe("takeCompleteSentences", () => {
  it("returns nothing for an empty string", () => {
    expect(takeCompleteSentences("")).toEqual({ sentences: [], rest: "" });
  });

  it("keeps a single incomplete sentence as rest", () => {
    expect(takeCompleteSentences("Half a thought")).toEqual({
      sentences: [],
      rest: "Half a thought",
    });
  });

  it("extracts a complete sentence, leaving the tail", () => {
    expect(takeCompleteSentences("First question? And then")).toEqual({
      sentences: ["First question?"],
      rest: "And then",
    });
  });

  it("handles . ! ? and … as terminators", () => {
    expect(takeCompleteSentences("Go. Run! Wait… done")).toEqual({
      sentences: ["Go.", "Run!", "Wait…"],
      rest: "done",
    });
  });

  it("treats line breaks as sentence ends", () => {
    expect(takeCompleteSentences("Line one\nLine two")).toEqual({
      sentences: ["Line one"],
      rest: "Line two",
    });
  });

  it("collapses runs of terminators into one boundary", () => {
    expect(takeCompleteSentences("Wait... Really?! done")).toEqual({
      sentences: ["Wait...", "Really?!"],
      rest: "done",
    });
  });

  it("trims surrounding whitespace off each sentence", () => {
    expect(takeCompleteSentences("  Hello.  World.  ")).toEqual({
      sentences: ["Hello.", "World."],
      rest: "",
    });
  });
});
