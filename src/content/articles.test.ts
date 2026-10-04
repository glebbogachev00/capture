import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ARTICLES, articleBySlug, articleWordCount } from "./articles";
import { SHARED_THREADS } from "./sharedThreads";

const SITE_ADAPTATIONS = [
  "software-i-can-use-while-running",
  "walking-to-find-ideas",
  "learning-to-publish-my-thoughts",
];

describe("Written with Capture articles", () => {
  it("keeps the three site adaptations with their record panels", () => {
    for (const slug of SITE_ADAPTATIONS) {
      const article = articleBySlug(slug);
      expect(article?.sourceMoments.length).toBeGreaterThanOrEqual(2);
      expect(article?.threadSummary).toBeTruthy();
      expect(article?.provenance).toBe(
        "Spoken while moving → sorted in Capture → developed with Hermes → edited by Gleb."
      );
      expect(article?.original?.url).toMatch(/^https:\/\/x\.com\/Peaceful_HN\/status\/\d+$/);
    }
  });

  it("publishes all thirteen X originals, ten as their own pages", () => {
    expect(ARTICLES).toHaveLength(13);
    expect(new Set(ARTICLES.map((a) => a.original?.url)).size).toBe(13);
    const imported = ARTICLES.filter((a) => !SITE_ADAPTATIONS.includes(a.slug));
    expect(imported).toHaveLength(10);
    for (const article of imported) {
      expect(article.sourceMoments).toEqual([]);
      expect(article.provenance).toBeUndefined();
      expect(article.original?.title).toBe(article.title);
      expect(article.body.startsWith("# ")).toBe(false);
      expect(articleWordCount(article)).toBeGreaterThan(300);
    }
  });

  it("lists articles newest first with unique slugs and local covers", () => {
    const dates = ARTICLES.map((a) => a.publishedAt);
    expect(dates).toEqual([...dates].sort().reverse());
    expect(new Set(ARTICLES.map((a) => a.slug)).size).toBe(ARTICLES.length);
    for (const article of ARTICLES) {
      expect(article.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(article.title.split(/\s+/).length).toBeGreaterThan(5);
      expect(article.cover?.src).toMatch(/^\/writing\//);
      expect(existsSync(join(process.cwd(), "public", article.cover!.src))).toBe(true);
    }
  });

  it("finds known articles without inventing unknown ones", () => {
    expect(articleBySlug("software-i-can-use-while-running")?.title).toBe(
      "The Software I Can Use While Running"
    );
    expect(articleBySlug("missing")).toBeUndefined();
  });
});

describe("Shared threads", () => {
  it("links each one to its public Capture Cloud page with a local portrait", () => {
    expect(SHARED_THREADS).toHaveLength(4);
    for (const thread of SHARED_THREADS) {
      expect(thread.url).toMatch(/^https:\/\/cloud\.trycapture\.app\/t\/[a-z0-9-]+$/);
      expect(existsSync(join(process.cwd(), "public", thread.portrait.src))).toBe(true);
    }
  });
});
