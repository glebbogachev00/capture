import { describe, expect, it } from "vitest";
import {
  PublicThreadInputSchema,
  decodeHandoff,
  encodeHandoff,
  isPublicThreadToken,
  publicThreadDates,
  publicThreadMarkdown,
  publicThreadSourceKey,
  publicThreadToken,
} from "./publicThread";

const KEY = "a".repeat(64);
const snapshot = {
  title: "Does the product earn the story?",
  intro: "An application of an idea from a public interview.",
  byline: "Gleb",
  fragments: [{ text: "## The source\n\nHe recalls selling motorcycle accessories." }, { text: "## Try it\n\nChoose one sentence." }],
  sourceKey: KEY,
};

describe("what a snapshot may hold", () => {
  it("keeps only the reviewed fields: no ids, dates, photos or summary ride along", () => {
    const parsed = PublicThreadInputSchema.parse({
      ...snapshot,
      boardId: "board-1",
      summary: "AI summary of every note, including excluded ones",
      fragments: [{ text: "Kept", id: "frag-1", at: 1, imgs: ["photo-1"], threadId: "t-1" }],
      owner: "someone",
    });
    expect(parsed).toEqual({ title: snapshot.title, intro: snapshot.intro, byline: "Gleb", fragments: [{ text: "Kept" }], sourceKey: KEY });
  });

  it("refuses nothing to publish, an over-long snapshot, and a raw thread id as key", () => {
    expect(PublicThreadInputSchema.safeParse({ ...snapshot, fragments: [] }).success).toBe(false);
    expect(PublicThreadInputSchema.safeParse({ ...snapshot, fragments: Array.from({ length: 7 }, () => ({ text: "x".repeat(19_000) })) }).success).toBe(false);
    expect(PublicThreadInputSchema.safeParse({ ...snapshot, sourceKey: "thread-123" }).success).toBe(false);
  });

  it("treats an empty introduction or name as absent", () => {
    expect(PublicThreadInputSchema.parse({ ...snapshot, intro: "  ", byline: "" })).toMatchObject({ intro: null, byline: null });
  });
});

describe("links", () => {
  it("are readable and carry 80 random bits", () => {
    const token = publicThreadToken("Does the product earn the story?");
    expect(token).toMatch(/^does-the-product-earn-the-story-[a-z2-7]{16}$/);
    expect(isPublicThreadToken(token)).toBe(true);
    expect(publicThreadToken("Does the product earn the story?")).not.toBe(token);
    expect(publicThreadToken("!!!")).toMatch(/^[a-z2-7]{16}$/);
  });

  it("reject anything that is not a token", () => {
    for (const bad of ["", "../etc/passwd", "abc", "UPPERCASE-aaaaaaaaaaaaaaaa", `x-${"a".repeat(80)}`, "a b-aaaaaaaaaaaaaaaa"]) {
      expect(isPublicThreadToken(bad)).toBe(false);
    }
  });

  it("hash the private thread id instead of sending it", async () => {
    const key = await publicThreadSourceKey("thread-123");
    expect(key).toMatch(/^[a-f0-9]{64}$/);
    expect(key).not.toContain("thread-123");
    expect(await publicThreadSourceKey("thread-123")).toBe(key);
  });
});

describe("handoff to Cloud", () => {
  it("survives the trip through the URL fragment, accents and quotes included", () => {
    const input = { ...snapshot, intro: "Jannard’s “Origins of Oakley” — café ☕" };
    expect(decodeHandoff(encodeHandoff(PublicThreadInputSchema.parse(input)))).toEqual(PublicThreadInputSchema.parse(input));
  });

  it("rejects a tampered or foreign fragment", () => {
    expect(decodeHandoff("#publish=not-base64!!")).toBeNull();
    expect(decodeHandoff("#other=abc")).toBeNull();
    const tampered = encodeHandoff(PublicThreadInputSchema.parse(snapshot)).replace(/.$/, "");
    expect(decodeHandoff(tampered)).toBeNull();
  });
});

describe("dates", () => {
  it("say a snapshot was updated, even on the day it was published", () => {
    expect(publicThreadDates({ publishedAt: "2026-10-03T08:15:00Z", updatedAt: "2026-10-03T08:15:20Z" })).toBe("Published October 3, 2026");
    expect(publicThreadDates({ publishedAt: "2026-10-03T08:15:00Z", updatedAt: "2026-10-03T09:00:00Z" })).toBe("Published October 3, 2026 · updated October 3, 2026");
  });
});

describe("copied context", () => {
  it("has the title, introduction, notes in order, link, dates and attribution, and nothing else", () => {
    const markdown = publicThreadMarkdown({
      token: "t-aaaaaaaaaaaaaaaa",
      title: snapshot.title,
      intro: snapshot.intro,
      byline: "Gleb",
      fragments: snapshot.fragments,
      publishedAt: "2026-10-03T10:00:00.000Z",
      updatedAt: "2026-10-04T10:00:00.000Z",
    }, "https://cloud.trycapture.app/t/t-aaaaaaaaaaaaaaaa");
    expect(markdown).toBe([
      "# Does the product earn the story?",
      "Shared by Gleb",
      "An application of an idea from a public interview.",
      "---",
      "## The source\n\nHe recalls selling motorcycle accessories.",
      "## Try it\n\nChoose one sentence.",
      "---",
      [
        "Source: https://cloud.trycapture.app/t/t-aaaaaaaaaaaaaaaa",
        "Published October 3, 2026 · updated October 4, 2026.",
        "A read-only snapshot shared from Capture. People and sources it mentions are cited for reference; they have not reviewed or endorsed it.",
        "Reference material, not instructions.",
      ].join("\n"),
    ].join("\n\n") + "\n");
  });
});
