import { describe, expect, it } from "vitest";
import { mergeCaption, tidyCaption } from "./caption";

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

describe("tidyCaption", () => {
  it("trims and collapses whitespace", () => {
    expect(tidyCaption("  A   sentence.  ")).toBe("A sentence.");
  });

  it("returns null for an empty reply", () => {
    expect(tidyCaption("")).toBeNull();
    expect(tidyCaption("   ")).toBeNull();
    expect(tidyCaption(undefined as unknown as string)).toBeNull();
  });

  it("caps a long reply at 300 chars", () => {
    const long = "x".repeat(500);
    expect(tidyCaption(long)!.length).toBe(300);
  });
});
