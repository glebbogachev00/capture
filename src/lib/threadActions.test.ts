import { describe, expect, it } from "vitest";
import { EMPTY, type Board } from "./model";
import type { CaptureEntry } from "./ledger";
import { actionsFromThread } from "./threadActions";

const action = (id: string, over: object = {}) =>
  ({ id, text: id, done: false, at: 1, imgs: [], shelf: "keep", expires: null, ...over }) as Board["actions"][number];

const entry = (over: object) =>
  ({ id: "e", at: 1, raw: "r", clean: "c", kind: "both", source: "typed", targetId: "", ...over }) as CaptureEntry;

describe("the actions a thread gave rise to", () => {
  it("links by threadId, splits open from done, excludes other threads", () => {
    const b: Board = {
      ...EMPTY,
      actions: [
        action("a", { threadId: "t1" }),
        action("b", { threadId: "t1", done: true }),
        action("c", { threadId: "t2" }),
        action("d"),
      ],
    };
    const out = actionsFromThread(b, "t1");
    expect(out.open.map((a) => a.id)).toEqual(["a"]);
    expect(out.done.map((a) => a.id)).toEqual(["b"]);
  });

  it("recovers pre-field actions through the ledger's both entries", () => {
    const b: Board = {
      ...EMPTY,
      actions: [action("a", { src: "ship the fix" }), action("x", { src: "unrelated" })],
      ledger: [entry({ id: "e1", clean: "ship the fix", targetId: "t1" })],
    };
    expect(actionsFromThread(b, "t1").open.map((a) => a.id)).toEqual(["a"]);
  });

  it("an undone capture vouches for nothing", () => {
    const b: Board = {
      ...EMPTY,
      actions: [action("a", { src: "ship the fix" })],
      ledger: [entry({ id: "e1", clean: "ship the fix", targetId: "t1", undone: true })],
    };
    expect(actionsFromThread(b, "t1").open).toEqual([]);
  });
});
