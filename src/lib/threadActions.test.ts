import { describe, expect, it } from "vitest";
import { EMPTY, type Board, type Thread } from "./model";
import type { CaptureEntry } from "./ledger";
import { actionsForThread } from "./threadActions";

const action = (id: string, over: object = {}) =>
  ({ id, text: id, done: false, at: 1, imgs: [], shelf: "keep", expires: null, ...over }) as Board["actions"][number];

const entry = (over: object) =>
  ({ id: "e", at: 1, raw: "r", clean: "c", kind: "both", source: "typed", targetId: "", ...over }) as CaptureEntry;

const thread = (over: object = {}): Thread =>
  ({ id: "t1", name: "Pricing model decisions", summary: "Seats or usage-based pricing for small teams.", frags: [], ...over }) as Thread;

describe("the actions that belong with a thread", () => {
  it("links by provenance, splits open from done, excludes other threads", () => {
    const b: Board = {
      ...EMPTY,
      actions: [
        action("a", { threadId: "t1" }),
        action("b", { threadId: "t1", done: true }),
        action("c", { threadId: "t2" }),
      ],
    };
    const out = actionsForThread(b, thread());
    expect(out.open.map((a) => a.id)).toEqual(["a"]);
    expect(out.done.map((a) => a.id)).toEqual(["b"]);
  });

  it("recovers pre-field actions through the ledger's both entries", () => {
    const b: Board = {
      ...EMPTY,
      actions: [action("a", { src: "ship the fix" })],
      ledger: [entry({ id: "e1", clean: "ship the fix", targetId: "t1" })],
    };
    expect(actionsForThread(b, thread()).open.map((a) => a.id)).toEqual(["a"]);
  });

  it("borrows an open action that shares the thread's subject", () => {
    const b: Board = {
      ...EMPTY,
      actions: [
        action("subject", { text: "Draft the usage-based pricing page" }),
        action("oneword", { text: "Fix the pricing typo in the footer" }),
        action("elsewhere", { text: "usage-based pricing memo", threadId: "t2" }),
      ],
    };
    const open = actionsForThread(b, thread()).open.map((a) => a.id);
    expect(open).toContain("subject");
    expect(open).not.toContain("oneword");
    expect(open).not.toContain("elsewhere");
  });

  it("an undone capture vouches for nothing", () => {
    const b: Board = {
      ...EMPTY,
      actions: [action("a", { src: "ship the fix" })],
      ledger: [entry({ id: "e1", clean: "ship the fix", targetId: "t1", undone: true })],
    };
    expect(actionsForThread(b, thread()).open).toEqual([]);
  });
});
