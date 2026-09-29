import { describe, expect, it } from "vitest";
import { mergeCaption, mergeCaptions, spokenText, tidyCaption } from "./caption";

describe("mergeCaption", () => {
  it("replaces the image-only placeholder with the caption", () => {
    expect(mergeCaption("(image only)", "A photo of a cat")).toBe(
      "Photo: A photo of a cat"
    );
  });

  it("handles empty raw text", () => {
    expect(mergeCaption("", "A red car")).toBe("Photo: A red car");
  });

  it("attaches the photo note to real text", () => {
    expect(mergeCaption("Note about the trip", "A mountain at sunset")).toBe(
      "Note about the trip\n\n(Attached photo: A mountain at sunset)"
    );
  });

  it("collapses whitespace in the caption", () => {
    expect(mergeCaption("(image only)", "  a   cat  ")).toBe(
      "Photo: a cat"
    );
  });

  it("returns the raw text when the caption is empty", () => {
    expect(mergeCaption("hello", "   ")).toBe("hello");
  });
});

describe("mergeCaptions", () => {
  it("keeps every image interpretation distinct and ordered", () => {
    expect(mergeCaptions("Compare these", ["First board", "Second board"]))
      .toBe("Compare these\n\n(Attached photo 1: First board)\n\n(Attached photo 2: Second board)");
  });

  it("labels each image-only interpretation without inventing a combined meaning", () => {
    expect(mergeCaptions("(image only)", ["Front label", "Back label"]))
      .toBe("Photos:\n- Photo 1: Front label\n- Photo 2: Back label");
  });

  it("removes numbered photo evidence from later spoken-text matching", () => {
    expect(spokenText(
      "Compare these\n\n(Attached photo 1: First board)\n\n(Attached photo 2: Second board)",
    )).toBe("Compare these");
  });
});

describe("tidyCaption", () => {
  it("trims and collapses whitespace", () => {
    expect(tidyCaption("  A   sentence.  ")).toBe("A sentence.");
  });

  it("returns null for an empty reply", () => {
    expect(tidyCaption("")).toBeNull();
    expect(tidyCaption("   ")).toBeNull();
    expect(tidyCaption(undefined as unknown as string)).toBeNull();
  });

  it.each([
    "(image only)",
    "  (IMAGE   ONLY)  ",
    "image only",
    "[no caption]",
    "No description available",
    "No description available.",
    "No caption available!",
    "(image only).",
    "'No caption'",
    "*Description unavailable*",
    "No caption,",
    "No description available:",
    "Caption unavailable;",
    "Description unavailable—",
    "No caption available–",
    "Image only-",
    "**(\"No caption available,\")**",
  ])("rejects the normalized image-only placeholder %j", (caption) => {
    expect(tidyCaption(caption)).toBeNull();
  });

  it.each([
    "A card reading ‘No description available.’",
    "The sign says no caption available!",
    "A screenshot with (image only). in its footer",
    "A page titled 'No caption' beside a diagram",
    "The note emphasizes *Description unavailable* below the photo",
    "A form says No caption, then shows the uploaded receipt",
    "The legend reads Description unavailable—beside a crossed-out thumbnail",
    "A screenshot contains **(\"No caption available,\")** in its warning banner",
  ])("preserves a real caption that merely contains sentinel words: %j", (caption) => {
    expect(tidyCaption(caption)).toBe(caption);
  });

  it("caps a long reply at 300 chars", () => {
    const long = "x".repeat(500);
    expect(tidyCaption(long)!.length).toBe(300);
  });
});
