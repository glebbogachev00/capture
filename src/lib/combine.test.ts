import { describe, expect, it } from "vitest";
import { applyCombine, combineContext, keepsEveryDetail, readCombine, COMBINE_CONTEXT_MAX } from "./combine";
import { EMPTY, type Board } from "./model";

const NOW = new Date(2026, 8, 30, 12).getTime();
const DAY = 864e5;
const board = (): Board => ({
  ...EMPTY,
  threads: [
    { id: "p", name: "Pricing", summary: "", frags: [
      { id: "a", text: "Move billing to annual, $8 a month.", at: NOW - 9 * DAY, imgs: ["img1"] },
      { id: "b", text: "Monthly churn is the worry.", at: NOW - 6 * DAY },
      { id: "c", text: "Annual billing at $8 — also means fewer card failures.", at: NOW - 3 * DAY },
      { id: "r", text: "Annual billing at $8 is live.", at: NOW - DAY, resolvedAt: NOW },
    ] },
    { id: "k", name: "Kitchen", summary: "", frags: [
      { id: "k1", text: "Tiles are grey.", at: NOW - 2 * DAY },
      { id: "k2", text: "Order grout.", at: NOW - DAY },
    ] },
    { id: "solo", name: "Solo", summary: "", frags: [{ id: "s", text: "Only one note.", at: NOW }] },
  ],
  actions: [{ id: "x", text: "check card failures", done: false, at: NOW, shelf: "days", expires: null, shot: { threadId: "p", fragId: "a" } }],
});

const ctx = combineContext(board(), NOW);
const label = (id: string) => Object.entries(ctx.notes).find(([, v]) => v.frag.id === id)![0];

describe("combineContext", () => {
  it("offers threads with two or more combinable notes, never resolved ones", () => {
    expect(Object.values(ctx.threads).map((t) => t.id).sort()).toEqual(["k", "p"]);
    expect(Object.values(ctx.notes).map((n) => n.frag.id)).not.toContain("r");
    expect(ctx.text).toContain("Move billing to annual, $8 a month.");
  });

  it("stays inside its budget on a huge board", () => {
    const big: Board = { ...EMPTY, threads: Array.from({ length: 400 }, (_, i) => ({
      id: `t${i}`, name: `T${i}`, summary: "", frags: [
        { id: `${i}a`, text: "x".repeat(300), at: NOW - i }, { id: `${i}b`, text: "y".repeat(300), at: NOW - i },
      ] })) };
    expect(combineContext(big, NOW).text.length).toBeLessThanOrEqual(COMBINE_CONTEXT_MAX + 40);
  });
});

describe("keepsEveryDetail", () => {
  it("refuses a combination that drops a number or grows", () => {
    expect(keepsEveryDetail(["annual at $8", "starts 12 March"], "Annual at $8, starting 12 March.")).toBe(true);
    expect(keepsEveryDetail(["annual at $8", "starts 12 March"], "Annual, starting in March.")).toBe(false);
    expect(keepsEveryDetail(["a", "b"], "a much longer rewrite than both notes were")).toBe(false);
  });
});

describe("readCombine", () => {
  const combined = "Move billing to annual, $8 a month — also means fewer card failures.";
  it("keeps groups within one thread whose wording keeps every detail", () => {
    const out = readCombine({ groups: [
      { notes: [label("c"), label("a")], combined, reason: "Both move billing to annual at $8." },
      { notes: [label("k1"), label("a")], combined: "x", reason: "cross-thread" },
      { notes: [label("k1"), label("k2")], combined: "Tiles are grey; order grout.", reason: "kitchen" },
      { notes: [label("b")], combined: "solo", reason: "one note" },
      { notes: ["N99", label("b")], combined: "?", reason: "invented label" },
    ] }, ctx)!;
    expect(out.map((p) => [p.threadId, p.frags.map((f) => f.id)])).toEqual([["p", ["a", "c"]], ["k", ["k1", "k2"]]]);
    expect(out[0].key).toBe("a+c");
  });

  it("drops a group that loses a number, and one the person kept apart", () => {
    const lossy = readCombine({ groups: [
      { notes: [label("a"), label("c")], combined: "Move billing to annual.", reason: "r" },
    ] }, ctx)!;
    expect(lossy).toEqual([]);
    const kept = readCombine({ groups: [{ notes: [label("a"), label("c")], combined, reason: "r" }] }, ctx, new Set(["a+c"]))!;
    expect(kept).toEqual([]);
    expect(readCombine({ nope: 1 }, ctx)).toBeNull();
  });
});

describe("applyCombine", () => {
  const proposals = readCombine({ groups: [
    { notes: [label("a"), label("c")], combined: "Move billing to annual, $8 a month — fewer card failures.", reason: "r" },
  ] }, ctx)!;

  it("folds the group into its newest note, keeping photos and repointing actions", () => {
    const out = applyCombine(board(), proposals, NOW)!;
    const p = out.board.threads.find((t) => t.id === "p")!;
    expect(p.frags.map((f) => f.id)).toEqual(["b", "c", "r"]);
    expect(p.frags[1]).toMatchObject({ text: "Move billing to annual, $8 a month — fewer card failures.", imgs: ["img1"], at: NOW - 3 * DAY });
    expect(out.board.actions[0].shot).toEqual({ threadId: "p", fragId: "c" });
    expect(out.threads).toEqual(["p"]);
    expect(out.notice).toBe("Combined 2 notes into 1.");
  });

  it("skips a group whose notes changed since it was proposed", () => {
    const edited = board();
    edited.threads[0].frags[0] = { ...edited.threads[0].frags[0], text: "Changed my mind: monthly." };
    expect(applyCombine(edited, proposals, NOW)).toBeNull();
  });
});
