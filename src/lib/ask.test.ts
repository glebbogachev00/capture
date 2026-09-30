import { describe, expect, it } from "vitest";
import { ASK_BUDGET, answerBlocks, askContext, readAnswer } from "./ask";
import { EMPTY, type Board, type Thread } from "./model";

const NOW = new Date(2026, 8, 30, 12).getTime();
const DAY = 864e5;

const thread = (id: string, name: string, notes: [string, number][], extra: Partial<Thread> = {}): Thread => ({
  id, name, summary: "", frags: notes.map(([text, at], i) => ({ id: `${id}-f${i}`, text, at })), ...extra,
});

const board = (patch: Partial<Board>): Board => ({ ...EMPTY, ...patch });

describe("askContext", () => {
  it("hands the model the whole board, not a word-matched slice of it", () => {
    const b = board({
      threads: [
        thread("p", "Pricing", [["going annual, $8 a month billed yearly", NOW - 3 * DAY]], { summary: "Settled on annual." }),
        thread("c", "Coffee", [["cut the 4pm espresso", NOW - DAY]]),
      ],
      actions: [{ id: "a1", text: "Email Maya the invoice", done: false, at: NOW - DAY, shelf: "days", expires: null }],
      intentions: [{ id: "i1", number: 1, rawInput: "i sleep", expandedIntention: "I sleep eight hours.",
        recommendedActions: ["Phone out of the room"], counterIntentions: ["Scrolling in bed"], at: NOW - 9 * DAY, updatedAt: NOW }],
    });
    const { text, refs, omitted } = askContext(b, NOW);
    // Nothing in the question decides what goes in: every note is present.
    expect(text).toContain("going annual, $8");
    expect(text).toContain("cut the 4pm espresso");
    expect(text).toContain("Where this stands: Settled on annual.");
    expect(text).toContain("[A1] Email Maya the invoice");
    expect(text).toContain("[I1] I sleep eight hours.");
    expect(text).toContain("Pulling against it: Scrolling in bed");
    expect(text).toContain("Today is Wednesday 2026-09-30.");
    expect(omitted).toBe(0);
    // Most recently active thread is T1.
    expect(refs.T1).toEqual({ kind: "thread", id: "c", name: "Coffee" });
    expect(refs.T2.id).toBe("p");
  });

  it("keeps unsorted captures on the device", () => {
    const b = board({
      threads: [thread("t", "Pricing", [["sorted note", NOW]]), thread("u", "Draft", [])],
      actions: [{ id: "a", text: "raw unsorted thing", done: false, at: NOW, shelf: "days", expires: null, unsorted: true }],
    });
    b.threads[0].frags.push({ id: "x", text: "pending words", at: NOW, unsorted: true });
    const { text, refs } = askContext(b, NOW);
    expect(text).not.toContain("raw unsorted thing");
    expect(text).not.toContain("pending words");
    expect(Object.values(refs).map((r) => r.id)).toEqual(["t"]);
  });

  it("fits a huge board by dropping the oldest notes, never a subject", () => {
    const notes: [string, number][] = Array.from({ length: 200 }, (_, i) => [`note ${i} ${"x".repeat(600)}`, NOW - i * DAY]);
    const b = board({
      threads: [thread("big", "Big", notes, { summary: "the whole story" }), thread("old", "Old", [["ancient", NOW - 900 * DAY]])],
    });
    const { text, omitted } = askContext(b, NOW);
    expect(text.length).toBeLessThanOrEqual(ASK_BUDGET + 2_000);
    expect(omitted).toBeGreaterThan(0);
    expect(text).toContain("note 0 ");
    expect(text).not.toContain("note 199 ");
    expect(text).toContain("### [T2] Old");
    expect(text).toContain("Where this stands: the whole story");
    expect(text).toMatch(/older notes not shown/);
  });
});

describe("readAnswer", () => {
  const refs = askContext(board({
    threads: [thread("p", "Pricing", [["annual", NOW]])],
    actions: [{ id: "a1", text: "Email Maya", done: false, at: NOW, shelf: "days", expires: null }],
  }), NOW).refs;

  it("maps labels back to items and drops ones the board never issued", () => {
    const out = readAnswer({ found: true, answer: "You chose **annual** [T1].", refs: ["T1", "T9", "[A1]", "T1"] }, refs);
    expect(out).toEqual({
      found: true,
      answer: "You chose **annual**.",
      refs: [{ kind: "thread", id: "p", name: "Pricing" }, { kind: "action", id: "a1", name: "Email Maya" }],
    });
  });

  it("refuses a malformed or empty reply rather than showing it", () => {
    expect(readAnswer({ answer: "hi" }, refs)).toBeNull();
    expect(readAnswer({ found: true, answer: " [T1] ", refs: [] }, refs)).toBeNull();
  });
});

describe("answerBlocks", () => {
  it("reads paragraphs, bullets, numbered steps and bold — nothing else becomes markup", () => {
    const blocks = answerBlocks("You decided on **annual**.\nIt was on 18 Sep.\n\n- one\n- **two**\n\n1. first\n2. second\n\n## <b>not html</b>");
    expect(blocks).toEqual([
      { type: "p", spans: [{ text: "You decided on ", bold: false }, { text: "annual", bold: true }, { text: ". It was on 18 Sep.", bold: false }] },
      { type: "ul", items: [[{ text: "one", bold: false }], [{ text: "two", bold: true }]] },
      { type: "ol", items: [[{ text: "first", bold: false }], [{ text: "second", bold: false }]] },
      { type: "p", spans: [{ text: "<b>not html</b>", bold: false }] },
    ]);
  });
});
