import { describe, expect, it } from "vitest";
import { CLEANUP_SYSTEM } from "./dictationCleanup";
import { FORMAT_SYSTEM, airy, keepsTheWords, needsFormatting, sentenceCase, shouldFormat } from "./captureFormat";

const dictated =
  "Um, so, I think one of my biggest worries right now is, uh, that I have so many ideas and main things that I can build. " +
  "But I don't have enough cash flow to invest everywhere, you know, or to develop the projects that keep developing.";

describe("what gets formatted", () => {
  it("formats long or filler-laden captures, however they were typed", () => {
    expect(shouldFormat(dictated)).toBe(true);
    expect(shouldFormat("um call mom")).toBe(true);
  });

  it("leaves short, structured and over-long captures alone (no model call)", () => {
    expect(shouldFormat("Call the landlord next Wednesday.")).toBe(false);
    expect(shouldFormat("## The source\n\nHe recalls a dynamometer test.")).toBe(false);
    expect(shouldFormat("Groceries:\n- milk\n- eggs and a long list of other things to remember for the week ahead, which goes on")).toBe(false);
    expect(shouldFormat("x".repeat(20_001))).toBe(false);
    expect(shouldFormat("   ")).toBe(false);
  });
});

describe("the cleaned text keeps the person's words", () => {
  it("accepts filler removal and layout", () => {
    const formatted =
      "I think one of my biggest worries right now is that I have so many ideas and main things that I can build.\n\n" +
      "But I don't have enough cash flow to invest everywhere or to develop the projects that keep developing.";
    expect(keepsTheWords(dictated, formatted)).toBe(true);
  });

  it("refuses a summary, invented words, or commentary", () => {
    expect(keepsTheWords(dictated, "Worried about cash flow across too many projects.")).toBe(false);
    expect(keepsTheWords(dictated, `Here is your cleaned text with improved structure and clarity:\n\n${dictated}`)).toBe(false);
    expect(keepsTheWords(dictated, "")).toBe(false);
  });
});

it("keeps the dictation-cleanup contract word for word and adds only layout", () => {
  expect(FORMAT_SYSTEM.startsWith(CLEANUP_SYSTEM.replace(/ Reply with the cleaned text only, no commentary\.$/, ""))).toBe(true);
  expect(FORMAT_SYSTEM).toContain("Do not correct, replace, spell-check");
  expect(FORMAT_SYSTEM).toMatch(/Line breaks and '- ' markers are the only things you may add/);
});

describe("short paragraphs", () => {
  const long = "I built Retake. I am not using it. I was focused on Capture. The thing I really need now is demos. " +
    "Find creative demos. Maybe a story around Capture. Mistakes are fine here.";

  it("splits a long paragraph into groups of two or three sentences, never leaving one alone", () => {
    const out = airy(long).split("\n\n");
    expect(out.length).toBeGreaterThan(1);
    for (const paragraph of out) {
      const count = paragraph.split(/(?<=[.!?])\s+/).length;
      expect(count).toBeGreaterThanOrEqual(2);
      expect(count).toBeLessThanOrEqual(4);
    }
    expect(airy(long).replace(/\s+/g, " ")).toBe(long.replace(/\s+/g, " "));
  });

  it("joins one-sentence paragraphs instead of leaving a column of one-liners", () => {
    const choppy = "First point here.\n\nSecond point here.\n\nThird point here.\n\nFourth point here.";
    expect(airy(choppy)).toBe("First point here. Second point here.\n\nThird point here. Fourth point here.");
  });

  it("leaves short paragraphs, lists and links alone", () => {
    expect(airy("One idea. Two ideas.")).toBe("One idea. Two ideas.");
    expect(airy("- one\n- two\n- three\n- four")).toBe("- one\n- two\n- three\n- four");
    const withLink = "See https://www.youtube.com/watch?v=MDoCijeHu-s&t=303s for the source. It is 05:03. Then 06:54. Also 1.5x speed. Done.";
    expect(airy(withLink)).toContain("https://www.youtube.com/watch?v=MDoCijeHu-s&t=303s");
    expect(airy(withLink).replace(/\s+/g, " ")).toBe(withLink);
  });
});

describe("sentence capitals", () => {
  it("capitalises sentence starts and a standalone i, for lowercase captures", () => {
    expect(sentenceCase("focus on retake. i'm not using it, i think. so we fix it!\n\nnext paragraph here.\n- one item"))
      .toBe("Focus on retake. I'm not using it, I think. So we fix it!\n\nNext paragraph here.\n- One item");
  });

  it("never touches words, links, names or text that is already cased", () => {
    const text = "See https://example.com/i/x and the iPhone app. ok, mail.com is fine. Retake stays Retake. e.g. this";
    expect(sentenceCase(text)).toBe("See https://example.com/i/x and the iPhone app. Ok, mail.com is fine. Retake stays Retake. E.g. this");
    expect(sentenceCase("Already Fine. Nothing to do.")).toBe("Already Fine. Nothing to do.");
  });
});

describe("Format on older notes settles after one press", () => {
  it("skips a short note that is already a fine single paragraph", () => {
    const fine = "My agents have been handling Retake pretty well. I also want to simplify this and create a UI where I can make different examples of videos, choose music and set the captions.";
    expect(shouldFormat(fine)).toBe(true);
    expect(needsFormatting(fine)).toBe(false);
  });

  it("still sends long blocks and notes with filler", () => {
    expect(needsFormatting(dictated)).toBe(true);
    expect(needsFormatting("First thing on my mind today. Second thing that came up on the walk. Third idea about the launch plan. Fourth and last point, which keeps the block going for a while here.")).toBe(true);
  });
});
