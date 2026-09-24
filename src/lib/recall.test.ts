import { describe, expect, it } from "vitest";
import type { Action, Board, Intention, Thread } from "./model";
import { search } from "./search";
import { RECALL_MAX_SOURCES, RECALL_MAX_SOURCE_CHARS, RecallSourceSchema, RecallAnswerSchema, isLikelyRecallQuestion, recallRequestFingerprint, recallSources, validateRecallAnswer } from "./recall";

const board = (patch: Partial<Board> = {}): Board => ({
  actions: [], threads: [], intentions: [], principles: [], ledger: [], corrections: [], ...patch,
});
const action = (id: string, text: string, patch: Partial<Action> = {}): Action => ({
  id, text, at: 10, done: false, shelf: "keep", expires: null, ...patch,
});
const thread = (id: string, text: string, patch: Partial<Thread> = {}): Thread => ({
  id, name: "Same name", summary: "Generated summary", frags: [{ id: "frag", text, at: 20 }], ...patch,
});
const intention = (id: string, rawInput: string): Intention => ({
  id, rawInput, expandedIntention: "Generated expansion", recommendedActions: [],
  counterIntentions: [], at: 30, updatedAt: 40, number: 1,
});

describe("isLikelyRecallQuestion", () => {
  it.each([
    "What did I decide about Capture pricing?",
    "When did we settle the launch date",
    "Did I write anything about orchard planting?",
    "Is the Cloud plan still the current decision",
    "¿Qué decidí sobre los precios?",
    "Что я решил о ценах？",
    "ماذا قررت بشأن التسعير؟",
    "为什么推迟发布？",
    "Τι αποφασίσαμε για την τιμολόγηση;",
    "ow should Capture handle rough thoughts?",
    "should Capture handle rough thoughts?",
    "Capture handle rough thoughts?",
    "handle rough thoughts?",
    "Quick brown fox?",
    "Question answer design?",
  ])("recognizes an explicit question: %s", (query) => {
    expect(isLikelyRecallQuestion(query)).toBe(true);
  });

  it.each([
    "Capture pricing",
    "notes about orchard planting",
    "I decided to keep thinking features free.",
    "what we decided about pricing",
    "show launch notes",
    "can opener",
    "can opener?",
    "Will Smith",
    "Will Smith?",
    "Project Alpha?",
    "Roadmap: Q4？",
    "Qué launch notes;",
    "Qué launch notes；",
    "what-did-I-decide?.md",
    "What did I decide?.txt",
    "\"What did I decide?\"",
    "“What did I decide?”",
    "What did",
    "Why is",
    "Can I",
    "ab",
    "x".repeat(501),
  ])("does not treat an ordinary search as a question: %s", (query) => {
    expect(isLikelyRecallQuestion(query)).toBe(false);
  });
});

describe("recallRequestFingerprint", () => {
  it("normalizes the question but keys the exact bounded source snapshot", () => {
    const sources = recallSources(board({ threads: [thread("t", "Pricing stays free")] }), "pricing");
    const first = recallRequestFingerprint("  WHAT   did I decide about pricing?  ", sources);
    expect(recallRequestFingerprint("what did i decide about pricing?", structuredClone(sources))).toBe(first);
    expect(recallRequestFingerprint("what did i decide about pricing?", [{ ...sources[0], text: "Pricing changed" }])).not.toBe(first);
    expect(recallRequestFingerprint("what did i decide about launch?", sources)).not.toBe(first);
  });
});

describe("recallSources", () => {
  it("never sends a waiting-to-sort capture as answer evidence", () => {
    const sources = recallSources(board({
      actions: [
        action("waiting", "private offline pricing draft", { unsorted: true }),
        action("ready", "published pricing decision"),
      ],
      threads: [thread("legacy", "private fragment pricing draft", {
        frags: [{ id: "legacy-frag", text: "private fragment pricing draft", at: 20, unsorted: true }],
      })],
    }), "pricing");
    expect(sources.map((source) => source.targetId)).toEqual(["ready"]);
    expect(JSON.stringify(sources)).not.toContain("private offline pricing draft");
    expect(JSON.stringify(sources)).not.toContain("private fragment pricing draft");
  });
});

describe("validateRecallAnswer", () => {
  const sources = recallSources(board({ threads: [thread("t", "Pricing stays\nfree. Café is open.")],
    actions: [action("a", "Pricing will change.")] }), "pricing");
  const source = sources.find((s) => s.kind === "thread")!;
  const valid = { status: "answered", claims: [{ text: "The note says pricing stays free.",
    citations: [{ sourceId: source.id, quote: "Pricing stays\nfree." }] }] };
  it("accepts exact source-bound quotes without mutation and accepts empty insufficient", () => {
    expect(validateRecallAnswer).toBeDefined();
    const before = structuredClone({ sources, valid });
    expect(validateRecallAnswer(valid, sources)).toEqual(valid);
    expect(validateRecallAnswer({ status: "insufficient", claims: [] }, [])).toEqual({ status: "insufficient", claims: [] });
    expect({ sources, valid }).toEqual(before);
  });
  it("rejects unknown IDs, URLs, cross-source quotes, normalized quotes and partial invalid answers wholesale", () => {
    for (const citation of [
      { sourceId: "unknown", quote: "Pricing stays\nfree." },
      { sourceId: "https://example.com", quote: "Pricing stays\nfree." },
      { sourceId: source.id, quote: "Pricing will change." },
      { sourceId: source.id, quote: "Pricing stays free." },
      { sourceId: source.id, quote: "pricing stays\nfree." },
      { sourceId: source.id, quote: "Cafe\u0301 is open." },
      { sourceId: source.id, quote: "Pricing…free." },
    ]) {
      const invalid = { status: "answered", claims: [...valid.claims, { text: "Unsupported", citations: [citation] }] };
      expect(validateRecallAnswer(invalid, sources)).toBeNull();
    }
    for (const invalid of [null, {}, { status: "answered", claims: [] },
      { status: "answered", claims: [{ text: "No citation", citations: [] }] },
      { status: "insufficient", claims: valid.claims }]) expect(validateRecallAnswer(invalid, sources)).toBeNull();
    expect(validateRecallAnswer(valid, [])).toBeNull();
  });
  it("rejects duplicate or malformed source inputs even when the answer is insufficient", () => {
    for (const invalidSources of [[...sources, source], [...sources, { ...source, text: "Different text" }],
      [{ ...source, at: Infinity }], Array(13).fill(source)]) {
      expect(validateRecallAnswer(valid, invalidSources)).toBeNull();
      expect(validateRecallAnswer({ status: "insufficient", claims: [] }, invalidSources)).toBeNull();
    }
  });
  it("does not claim structural validation proves semantic entailment", () => {
    // A real quote with an unrelated assertion is structurally valid. Semantic
    // support is the answering model/user's responsibility, not substring math.
    const unsupportedMeaning = { ...valid, claims: [{ ...valid.claims[0], text: "The moon is made of cheese." }] };
    expect(validateRecallAnswer(unsupportedMeaning, sources)).toEqual(unsupportedMeaning);
  });
});

describe("RecallAnswerSchema", () => {
  const citation = { sourceId: "a", quote: "verbatim quote" };
  const claim = { text: "A claim", citations: [citation] };
  it("requires nonempty cited claims for answered and zero claims for insufficient", () => {
    expect(RecallAnswerSchema).toBeDefined();
    expect(RecallAnswerSchema.safeParse({ status: "answered", claims: [claim] }).success).toBe(true);
    expect(RecallAnswerSchema.safeParse({ status: "insufficient", claims: [] }).success).toBe(true);
    for (const value of [
      null, "answer", {}, { status: "unknown", claims: [] },
      { status: "answered", claims: [] }, { status: "insufficient", claims: [claim] },
      { status: "answered", claims: [{ ...claim, citations: [] }] },
      { status: "answered", claims: [claim], url: "https://untrusted.example" },
      { status: "answered", claims: [{ ...claim, extra: true }] },
      { status: "answered", claims: [{ ...claim, citations: [{ ...citation, url: "https://untrusted.example" }] }] },
    ]) expect(RecallAnswerSchema.safeParse(value).success).toBe(false);
  });
  it("rejects overflow or whitespace instead of trimming or silently dropping a claim", () => {
    const answer = (patch: object) => ({ status: "answered", claims: [{ ...claim, ...patch }] });
    expect(RecallAnswerSchema.safeParse({ status: "answered", claims: Array(5).fill(claim) }).success).toBe(true);
    expect(RecallAnswerSchema.safeParse({ status: "answered", claims: Array(6).fill(claim) }).success).toBe(false);
    for (const text of ["", "   ", "x".repeat(701)]) expect(RecallAnswerSchema.safeParse(answer({ text })).success).toBe(false);
    expect(RecallAnswerSchema.safeParse(answer({ text: "x".repeat(700), citations: Array(4).fill(citation) })).success).toBe(true);
    expect(RecallAnswerSchema.safeParse(answer({ citations: Array(5).fill(citation) })).success).toBe(false);
    for (const quote of ["x".repeat(7), "x".repeat(601), " ".repeat(8)]) {
      expect(RecallAnswerSchema.safeParse(answer({ citations: [{ ...citation, quote }] })).success).toBe(false);
    }
    for (const quote of ["x".repeat(8), "x".repeat(600)]) {
      expect(RecallAnswerSchema.safeParse(answer({ citations: [{ ...citation, quote }] })).success).toBe(true);
    }
    for (const sourceId of ["", " ", "x".repeat(401)]) {
      expect(RecallAnswerSchema.safeParse(answer({ citations: [{ ...citation, sourceId }] })).success).toBe(false);
    }
  });
});

describe("RecallSourceSchema", () => {
  it("enforces the exact bounded transport shape without changing evidence", () => {
    expect(RECALL_MAX_SOURCES).toBe(12);
    expect(RECALL_MAX_SOURCE_CHARS).toBe(1500);
    expect(RecallSourceSchema).toBeDefined();
    const source = recallSources(board({ threads: [thread("t", "Pricing stays free")] }), "pricing")[0];
    expect(RecallSourceSchema.parse(source)).toEqual(source);
    for (const patch of [
      { id: "" }, { id: "x".repeat(401) }, { targetId: "x".repeat(401) }, { fragId: "x".repeat(401) },
      { title: "x".repeat(161) }, { text: "x".repeat(1501) }, { text: "  " }, { at: Infinity }, { at: NaN },
      { at: 8_640_000_000_000_001 }, { at: -8_640_000_000_000_001 },
      { kind: "summary" }, { state: "unknown" }, { truncated: "true" }, { url: "https://untrusted.example" },
    ]) expect(RecallSourceSchema.safeParse({ ...source, ...patch }).success).toBe(false);
  });
});

describe("recallSources", () => {
  it("uses a specific thread title to locate originals, ranks direct evidence first, and never quotes the title", () => {
    const input = board({ threads: [
      thread("context", "I chose the monthly plan", { name: "Capture pricing", summary: "Invented annual commitment",
        frags: [{ id: "f", text: "I chose the monthly plan", at: 900 }] }),
      thread("direct", "Pricing stays free", { name: "Other topic" }),
      thread("generic", "I must decide on a new logo", { name: "Capture" }),
    ] });
    const sources = recallSources(input, "What did I decide about Capture pricing?");
    expect(sources.map((s) => s.targetId)).toEqual(["direct", "context"]);
    expect(sources[1]).toMatchObject({ title: "Capture pricing", text: "I chose the monthly plan", at: 900, fragId: "f" });
    expect(recallSources(input, "What about Capture?")).toEqual([]);
    const answer = (quote: string) => ({ status: "answered", claims: [{ text: "Monthly plan selected",
      citations: [{ sourceId: sources[1].id, quote }] }] });
    expect(validateRecallAnswer(answer("I chose the monthly plan"), sources)).not.toBeNull();
    expect(validateRecallAnswer(answer("Capture pricing"), sources)).toBeNull();
    expect(validateRecallAnswer(answer("Invented annual commitment"), sources)).toBeNull();
  });

  it("omits ambiguous duplicate board identities instead of assigning citations to either original", () => {
    const input = board({ actions: [action("same", "Pricing one"), action("same", "Pricing two"),
      action("unique", "Pricing three")], threads: [thread("t", "unused", { frags: [
        { id: "f", at: 1, text: "Pricing four" }, { id: "f", at: 2, text: "Unrelated original" },
      ] })] });
    expect(recallSources(input, "pricing").map((s) => s.targetId)).toEqual(["unique"]);
  });

  it("keeps query scaffolding from retrieving unrelated work", () => {
    const input = board({ actions: [action("work", "Working on a kitchen remodel lately") ] });
    expect(recallSources(input, "What have I been working on lately?")).toEqual([]);
  });

  it("keeps contradictory dated originals and explicit lifecycle states, without mutating", () => {
    const input = board({
      threads: [thread("t", "unused", { frags: [
        { id: "old", text: "Pricing must be free", at: 100, resolvedAt: 0 },
        { id: "new", text: "Pricing must not be free", at: 200 },
      ] })],
      actions: [action("done", "Review pricing", { done: true, faded: true, at: 50 }),
        action("faded", "Revisit pricing", { faded: true, at: 60 })],
      intentions: [intention("i", "Keep pricing sustainable")],
    });
    const before = structuredClone(input);
    const sources = recallSources(input, "pricing");
    expect(sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: "Pricing must be free", at: 100, state: "resolved" }),
      expect.objectContaining({ text: "Pricing must not be free", at: 200, state: "active" }),
      expect.objectContaining({ targetId: "done", at: 50, state: "done" }),
      expect.objectContaining({ targetId: "faded", at: 60, state: "faded" }),
      expect.objectContaining({ targetId: "i", at: 30, state: "active" }),
    ]));
    expect(input).toEqual(before);
  });

  it("uses stable collision-safe IDs, not thread names or array positions", () => {
    const input = board({ threads: [
      thread("a:b", "Pricing one", { frags: [{ id: "c", text: "Pricing one", at: 0 }] }),
      thread("a", "Pricing two", { frags: [{ id: "b:c", text: "Pricing two", at: 0 }] }),
      thread("other", "Pricing three", { frags: [{ id: "c", text: "Pricing three", at: 0 }] }),
    ], actions: [action("a:b:c", "Pricing four", { at: 0 })] });
    const sources = recallSources(input, "pricing");
    expect(new Set(sources.map((s) => s.id)).size).toBe(4);
    expect(sources.filter((s) => s.kind === "thread").every((s) => s.title === "Same name")).toBe(true);
    const reordered = { ...input, threads: [...input.threads].reverse().map((t) => ({ ...t, name: "Renamed" })) };
    expect(recallSources(reordered, "pricing").map((s) => s.id)).toEqual(sources.map((s) => s.id));
  });

  it("bounds text and titles while keeping the matched excerpt verbatim", () => {
    const raw = `  ${"unrelated ".repeat(300)}Pricing stays free. ${"details ".repeat(300)}  `;
    const input = board({ threads: [thread("long", raw, { name: "title ".repeat(100) })],
      actions: [action("short", "  Pricing\n stays free.  ")] });
    const sources = recallSources(input, "pricing");
    const long = sources.find((s) => s.targetId === "long")!;
    expect(long.text.length).toBeLessThanOrEqual(1500);
    expect(long.title.length).toBeLessThanOrEqual(160);
    expect(long.text).toContain("Pricing stays free.");
    expect(raw).toContain(long.text);
    expect(long.truncated).toBe(true);
    expect(sources.find((s) => s.targetId === "short")).toMatchObject({ text: "Pricing\n stays free.", truncated: false });
  });

  it("omits invalid timestamps, empty evidence and unrepresentable IDs rather than inventing or clipping identity", () => {
    const input = board({ actions: [
      action("bad-date", "Pricing", { at: NaN }), action("infinity", "Pricing", { at: Infinity }),
      action("future", "Pricing", { at: 8_640_000_000_000_001 }),
      action("past", "Pricing", { at: -8_640_000_000_000_001 }),
      action("", "Pricing"), action("x".repeat(401), "Pricing"), action("empty", "  "),
      action("good", "Pricing"),
    ] });
    expect(recallSources(input, "pricing").map((s) => s.targetId)).toEqual(["good"]);
  });

  it("ranks term coverage then rarity ahead of recency and repeated generic words", () => {
    const input = board({ actions: [
      action("generic", "capture ".repeat(100), { at: 999 }),
      action("common", "pricing", { at: 998 }),
      action("rare", "Offline encryption matters", { at: 1 }),
      action("covered", "Offline pricing and encryption", { at: 0 }),
      ...Array.from({ length: 15 }, (_, i) => action(`noise-${i}`, "pricing", { at: 100 + i })),
    ] });
    const sources = recallSources(input, "What did I say about Capture pricing encryption?");
    expect(sources.slice(0, 2).map((s) => s.targetId)).toEqual(["covered", "rare"]);
    expect(sources).toHaveLength(12);
    expect(sources.some((s) => s.targetId === "generic")).toBe(false);
    expect(recallSources(input, "pricing pricing pricing encryption capture")).toEqual(sources);
    expect(recallSources({ ...input, actions: [...input.actions].reverse() }, "capture pricing encryption")).toEqual(sources);
  });

  it.each(["", "   ", "?!", "What have I been thinking about?", "Summarize all my notes", "What did I capture?", "tell me everything", "What is important?", "unicorn"])(
    "returns no unrelated fallback or broad-board dump for %j", (question) => {
      const input = board({ actions: [action("a", "I have been thinking about capture notes and important pricing") ] });
      expect(recallSources(input, question)).toEqual([]);
      expect(recallSources(board(), question)).toEqual([]);
    },
  );

  it("matches Unicode words without requiring every question word", () => {
    const input = board({ actions: [
      action("ru", "Обсудить БЮДЖЕТ завтра"),
      action("zh", "研究 预算"),
      action("vi", "Café ngân sách"),
      action("substring", "Context is unrelated"),
    ] });
    expect(recallSources(input, "What about бюджет or 预算?").map((s) => s.targetId).sort()).toEqual(["ru", "zh"]);
    expect(recallSources(input, "What about CAFE\u0301?").map((s) => s.targetId)).toEqual(["vi"]);
    expect(recallSources(input, "text")).toEqual([]);
  });

  it("never matches generated summaries, expansions or action provenance alone", () => {
    const input = board({
      actions: [action("a", "Buy milk", { src: "pricing" })],
      threads: [thread("t", "Unrelated original", { name: "Generated title", summary: "pricing" })],
      intentions: [{ ...intention("i", "Enjoy swimming"), expandedIntention: "pricing", recommendedActions: ["pricing"] }],
    });
    expect(recallSources(input, "pricing")).toEqual([]);
  });

  it("retrieves original evidence for natural questions that exact search misses", () => {
    const input = board({
      actions: [action("a", "Review pricing options")],
      threads: [thread("t", "Pricing should stay free")],
      intentions: [intention("i", "I want sustainable pricing")],
    });
    const question = "What did I say about pricing?";
    expect(search(input, question).total).toBe(0);
    const sources = recallSources(input, question);
    expect(sources).toHaveLength(3);
    expect(sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "action", targetId: "a", text: "Review pricing options", at: 10 }),
      expect.objectContaining({ kind: "thread", targetId: "t", fragId: "frag", text: "Pricing should stay free", at: 20 }),
      expect.objectContaining({ kind: "intention", targetId: "i", text: "I want sustainable pricing", at: 30 }),
    ]));
  });
});
