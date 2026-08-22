import { describe, expect, it } from "vitest";
import { sameShape, seriesFor, SERIES_WINDOW_MS } from "./series";

const POST_A = `Mon — capture-two-places\n\nTuesday, 11pm, I say to myself: "fix the signup bug before Friday, and I still can't decide on pricing."\n\nThat's two different things. One is a task with a deadline. The other is a question I've been circling for a month.`;
const POST_B = `Tue — mark-done\n\nI had a list of 400 things. I'd finished maybe 30 of them. The other 370 just sat there, and every time I opened the list I felt the 370, not the 30.\n\nIn Capture I finished one thing today and the board said "No open loops."`;

describe("a series — the next one in a set", () => {
  it("sees two titled drafts minutes apart as a set", () => {
    /* The real case: three post drafts, three minutes apart, three
       threads. Different subjects, same shape. */
    const s = seriesFor(POST_B, { raw: POST_A, at: 1_000_000, threadId: "t", threadName: "Capture X posts" }, 1_000_000 + 3 * 60_000);
    expect(s).toEqual({ threadId: "t", threadName: "Capture X posts", minutesAgo: 3 });
  });

  it("is not a set when the previous one was long ago", () => {
    expect(seriesFor(POST_B, { raw: POST_A, at: 0, threadId: "t", threadName: "x" }, SERIES_WINDOW_MS + 1)).toBeNull();
  });

  it("two short sentences in a row are not a set", () => {
    expect(sameShape("buy oat milk", "call the vet about luna")).toBe(false);
    expect(seriesFor("call the vet", { raw: "buy oat milk", at: 0, threadId: "t", threadName: "x" }, 60_000)).toBeNull();
  });

  it("a long paste after a short sentence is not a set", () => {
    expect(sameShape("buy oat milk", POST_B)).toBe(false);
  });

  it("two long pastes without headings still match on paragraphs", () => {
    const a = "one ".repeat(50) + "\n\n" + "two ".repeat(50);
    const b = "three ".repeat(50) + "\n\n" + "four ".repeat(50);
    expect(sameShape(a, b)).toBe(true);
  });
});
