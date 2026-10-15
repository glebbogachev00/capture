import { describe, expect, it } from "vitest";
import { CLEANUP_SYSTEM } from "./dictationCleanup";
import {
  FORMAT_SYSTEM, airy, firstJsonObject, keepsTheWords, needsFormatting, needsHeadings, numberedParagraphs, placeHeadings,
  sentenceCase, shouldFormat,
} from "./captureFormat";

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

describe("Russian dictation", () => {
  const raw = "ну короче я сегодня гуляла в парке и подумала что было бы классно начать вести дневник благодарности каждый вечер записывать три вещи за которые я благодарна и еще надо купить красивый блокнот для этого";
  const cleaned = "Я сегодня гуляла в парке и подумала, что было бы классно начать вести дневник благодарности.\n\nКаждый вечер записывать три вещи, за которые я благодарна.\n\nИ ещё надо купить красивый блокнот для этого.";

  it("keeps a good cleanup that drops ну/короче and writes ещё with ё", () => {
    expect(keepsTheWords(raw, cleaned)).toBe(true);
  });

  it("is sent for cleanup when it carries Russian filler, even when short", () => {
    expect(shouldFormat("ну короче купить молоко")).toBe(true);
    expect(shouldFormat("Купить молоко")).toBe(false);
    expect(shouldFormat("Нужно купить молоко")).toBe(false);
  });

  it("still refuses a cleanup that drops real words", () => {
    expect(keepsTheWords(raw, "Начать вести дневник благодарности.")).toBe(false);
  });
});

describe("sentence case in Russian", () => {
  it("starts each Russian sentence with a capital", () => {
    expect(sentenceCase("я сегодня гуляла в парке. каждый вечер записывать три вещи.")).toBe("Я сегодня гуляла в парке. Каждый вечер записывать три вещи.");
    expect(sentenceCase("ещё надо купить блокнот")).toBe("Ещё надо купить блокнот");
  });
});


describe("headings on long notes", () => {
  const paragraph = (topic: string) =>
    `This part is about ${topic} and it goes on for a while, because I keep thinking out loud about it. ` +
    `There is a lot to say about ${topic}, so I say it, and then I say a bit more about why ${topic} matters to me right now.`;
  const note = ["launch", "launch", "pricing", "pricing", "the team", "the team"].map(paragraph).join("\n\n");

  it("are only for long notes laid out in paragraphs and not headed yet", () => {
    expect(needsHeadings(note)).toBe(true);
    expect(needsHeadings(paragraph("launch"))).toBe(false);
    expect(needsHeadings(note.replace(/\n\n/g, " "))).toBe(false);
    expect(needsHeadings(`### Launch\n\n${note}`)).toBe(false);
  });

  it("number the paragraphs for the model", () => {
    expect(numberedParagraphs("One.\n\nTwo.")).toBe("[1] One.\n\n[2] Two.");
  });

  it("go between paragraphs and never change a word of the note", () => {
    const out = placeHeadings(note, { headings: [{ before: 1, title: "The launch" }, { before: 3, title: "pricing i’m sure of." }, { before: 5, title: "Who builds it" }] });
    expect(out.split("\n\n").filter((block) => block.startsWith("### "))).toEqual(["### The launch", "### Pricing I’m sure of", "### Who builds it"]);
    expect(out.split("\n\n").filter((block) => !block.startsWith("### ")).join("\n\n")).toBe(note);
  });

  it("keep a part at least two paragraphs, and drop titles that do not hold up", () => {
    const out = placeHeadings(note, { headings: [
      { before: 1, title: "The launch" }, { before: 2, title: "Too soon" }, { before: 3, title: "**Pricing**" },
      { before: 3, title: "A title that runs on far too long to be a heading" }, { before: 4, title: "Pricing" }, { before: 6, title: "Last line alone" },
    ] });
    expect(out.split("\n\n").filter((block) => block.startsWith("### "))).toEqual(["### The launch", "### Pricing"]);
  });

  it("leave the note as it was when there is less than two parts, or the first starts late", () => {
    expect(placeHeadings(note, { headings: [{ before: 1, title: "Everything" }] })).toBe(note);
    expect(placeHeadings(note, { headings: [{ before: 4, title: "Pricing" }, { before: 6, title: "Team" }] })).toBe(note);
    expect(placeHeadings(note, { headings: [] })).toBe(note);
    expect(placeHeadings(note, "nonsense")).toBe(note);
  });

  it("read the JSON out of a chatty answer", () => {
    expect(firstJsonObject('Sure: {"headings": []} hope that helps')).toEqual({ headings: [] });
    expect(firstJsonObject("no json here")).toBeNull();
  });

  it("stay on their own line through layout and capitals", () => {
    const headed = `### the launch\n\nfirst point here. second point here.\n\n### pricing\nThird point here.`;
    expect(airy(headed)).toBe("### the launch\n\nfirst point here. second point here.\n\n### pricing\n\nThird point here.");
    expect(sentenceCase("### the launch\n\nfirst point.")).toBe("### The launch\n\nFirst point.");
  });
});
