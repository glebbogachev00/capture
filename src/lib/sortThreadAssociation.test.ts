import { describe, expect, it } from "vitest";
import { applySorted, type SortResult } from "./boardOps";
import { EMPTY, type Board } from "./model";
import { reconcileSorted } from "./sort";
import { actionsForThread } from "./threadActions";
import { recordSortedCapture } from "./settle";
import { hydrate } from "./model";
import { mergeBoards } from "./sync";
import "fake-indexeddb/auto";
import { createStorage } from "./storage";
import { OwnershipLifetime } from "./ownership";

// Synthetic reconstruction of the reported subjects, NOT the user's exact transcript.
const clean = "Fix the Stripe webhook retry bug. I am still debating annual pricing versus monthly pricing. Call mom this weekend.";
const board = (): Board => ({ ...EMPTY, threads: [{ id: "pricing", name: "Annual pricing", summary: "Annual pricing versus monthly pricing is still undecided.", frags: [] }] });
const result = (over: Partial<SortResult> = {}): SortResult => ({
  kind: "both", title: "Pricing and errands", clean,
  actions: ["Fix the Stripe webhook retry bug", "Call mom this weekend"],
  threadId: "pricing", threadName: null, primaryText: null, also: [], ...over,
});

describe("mixed capture action-to-thread association", () => {
  it("a both result collapsed to action still keeps its thinking out of task operations", () => {
    const out = reconcileSorted(result({ actions: ["Call mom this weekend"], primaryText: "Annual pricing is undecided.", threadId: null, threadName: null }));
    expect(out.kind).toBe("action");
    expect(applySorted(out, [], 1000, board()).next.actions[0].src).toBe("Call mom this weekend");
  });

  it.each([undefined, null, [0], [999], "0", {}, [null], ["unknown"], ["call mom this weekend"]].map(selection => [selection]))("unknown selection %j never throws or claims a task", (selection) => {
    const out = result({ primaryActions: selection as SortResult["primaryActions"] });
    const { next } = applySorted(reconcileSorted(out), [], 1000, board());
    expect(next.actions).toHaveLength(2);
    expect(next.actions.every(a => !a.threadId)).toBe(true);
  });
  it("only accepts exact existing action strings, ignoring non-string siblings", () => {
    const { next } = applySorted(result({ primaryActions: [0, "Call mom this weekend", "unknown"] as unknown as string[] }), [], 1000, board());
    expect(next.actions.map(a => a.threadId)).toEqual([undefined, "pricing"]);
  });

  it.each(["summary only", "same-capture fragment", "same-capture split", "legacy source copy"])("requires independent notes, not %s", (shape) => {
    const out = result({ primaryText: "I am still debating annual pricing versus monthly pricing." });
    const b = applySorted(out, [], 1000, board()).next;
    const t = b.threads[0];
    t.summary = "Fix the Stripe webhook retry bug and call mom this weekend.";
    if (shape === "same-capture fragment") t.frags = [{ id: "mixed", text: clean, at: 1000 }];
    if (shape === "same-capture split") t.frags = [{ id: "split", text: "Call mom this weekend.", at: 1000 }];
    if (shape === "legacy source copy") {
      b.actions = b.actions.map(a => ({ ...a, src: clean }));
      t.frags = [{ id: "copied", text: clean, at: 900 }];
    }
    const before = JSON.stringify(b);
    expect(actionsForThread(b, t).open).toEqual([]);
    expect(JSON.stringify(b)).toBe(before);
    // A separate, older note can establish the subject without trusting summary.
    t.frags.push({ id: "independent", text: "Stripe webhook retry bug investigation", at: 800 });
    expect(actionsForThread(b, t).open.map(a => a.text)).toEqual([out.actions![0]]);
  });

  it.each([false, true])("survives persistence, reopen and both merge directions (explicit pricing task: %s)", async (related) => {
    const pricingTask = "Send the comparison to Jen";
    const out = reconcileSorted(result({
      primaryText: "I am still debating annual pricing versus monthly pricing.",
      actions: [...result().actions!, ...(related ? [pricingTask] : [])],
      primaryActions: related ? [pricingTask] : [],
    }));
    const applied = applySorted(out, [], 1000, board());
    let id = 0;
    const recorded = recordSortedCapture(applied.next, {
      raw: clean, payload: clean, at: 1000, dictated: false, imgIds: [], captureId: "synthetic",
      kind: out.kind, clean: out.clean, primaryText: out.primaryText,
      primary: { targetId: applied.targetId!, fragId: applied.source?.fragId }, also: [],
    }, () => `ledger-${++id}`).board;
    // Real storage code, isolated in-memory IndexedDB; never opens user data.
    const lifetime = new OwnershipLifetime();
    await createStorage(lifetime).set("synthetic-association", JSON.stringify(recorded));
    const reopened = hydrate(JSON.parse((await createStorage(lifetime).get("synthetic-association"))!));
    for (const b of [recorded, reopened, mergeBoards(board(), reopened), mergeBoards(reopened, board())]) {
      expect(b.actions.map(a => a.threadId)).toEqual(related ? [undefined, undefined, "pricing"] : [undefined, undefined]);
      expect(actionsForThread(b, b.threads[0]).open.map(a => a.text)).toEqual(related ? [pricingTask] : []);
      expect(b.ledger[0].raw).toBe(clean);
      expect(b.ledger[0].clean).toBe(clean);
    }
  });

  it("uses the selected id, not a same-title sibling; explicit links survive a rename", () => {
    const b = board();
    b.threads.push({ ...b.threads[0], id: "same-title" });
    const { next } = applySorted(result({ actions: ["Send the comparison to Jen"], primaryActions: ["Send the comparison to Jen"], threadId: "same-title" }), [], 1000, b);
    expect(next.actions[0].threadId).toBe("same-title");
    expect(actionsForThread(next, next.threads[0]).open).toEqual([]);
    next.threads[1].name = "Renamed deliberation";
    expect(actionsForThread(next, next.threads[1]).open).toEqual(next.actions);
  });

  it("keeps standalone actions and never resolves a new thread by title", () => {
    const { next } = applySorted(result({ actions: ["Send the comparison to Jen"], primaryActions: ["Send the comparison to Jen", "Invented task"], threadId: null, threadName: "Annual pricing" }), [], 1000, board());
    expect(next.threads).toHaveLength(2);
    expect(next.actions).toHaveLength(1);
    expect(next.actions[0].threadId).toBe(next.threads[0].id);
    expect(next.actions[0].threadId).not.toBe("pricing");
  });

  it("does not rewrite already saved associations or notes", () => {
    const b = board();
    b.actions = [{ id: "old", text: "Call mom", threadId: "pricing", src: clean, done: false, at: 1, shelf: "keep", expires: null }];
    const before = JSON.stringify(b);
    expect(actionsForThread(b, b.threads[0]).open).toEqual(b.actions);
    expect(JSON.stringify(b)).toBe(before);
  });
  it("does not save unrelated Stripe and mom actions as children of the only thinking thread", () => {
    const out = reconcileSorted(result());
    const { next } = applySorted(out, [], 1000, board());
    expect(next.actions.map(a => a.threadId)).toEqual([undefined, undefined]);
    expect(actionsForThread(next, next.threads[0]).open).toEqual([]);
    expect(next.actions.map(a => a.text)).toEqual(out.actions);
    expect(out.clean).toBe(clean);
  });

  it("files only the thinking share even when no second thread is needed", () => {
    const thinking = "I am still debating annual pricing versus monthly pricing.";
    const out = reconcileSorted(result({ primaryText: thinking }));
    const { next } = applySorted(out, [], 1000, board());
    expect(next.threads[0].frags[0].text).toBe(thinking);
    expect(out.clean).toBe(clean);
  });

  it("does not derive a relationship from a shared multi-subject source or its ledger entry", () => {
    const b = board();
    b.actions = [{ id: "mom", text: "Call mom this weekend", src: clean, at: 1000, done: false, shelf: "keep", expires: null }];
    b.ledger = [{ id: "capture", raw: clean, clean, at: 1000, kind: "both", source: "typed", targetId: "pricing" }];
    expect(actionsForThread(b, b.threads[0]).open).toEqual([]);
  });

  it("does not borrow a split action using the primary share as its source", () => {
    const { next } = applySorted(reconcileSorted(result({ primaryText: "I am still debating annual pricing versus monthly pricing.", also: [{ text: "The onboarding flow needs a calmer introduction.", threadName: "Onboarding" }] })), [], 1000, board());
    expect(next.actions.map(a => a.threadId)).toEqual([undefined, undefined]);
    expect(actionsForThread(next, next.threads.find(t => t.id === "pricing")!).open).toEqual([]);
  });
});
