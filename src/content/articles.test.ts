import { describe, expect, it } from "vitest";
import { ARTICLES, articleBySlug, articleWordCount } from "./articles";

describe("Written with Capture articles", () => {
  it("ships three substantial, human-titled articles", () => {
    expect(ARTICLES).toHaveLength(3);
    for (const article of ARTICLES) {
      expect(article.title).not.toContain("...");
      expect(article.title.split(/\s+/).length).toBeGreaterThan(5);
      expect(articleWordCount(article)).toBeGreaterThanOrEqual(900);
      expect(article.sourceMoments.length).toBeGreaterThanOrEqual(2);
      expect(article.provenance).toBe(
        "Spoken while moving → sorted in Capture → developed with Hermes → edited by Gleb."
      );
    }
  });

  it("finds known articles without inventing unknown ones", () => {
    expect(articleBySlug("software-i-can-use-while-running")?.title).toBe(
      "The Software I Can Use While Running"
    );
    expect(articleBySlug("missing")).toBeUndefined();
  });
});
