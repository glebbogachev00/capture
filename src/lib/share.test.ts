import { describe, expect, it } from "vitest";
import type { Action } from "./model";
import { shareAction } from "./share";
describe("shareAction — one task, on its way to an assistant", () => {
  const act = (over: Partial<Action> = {}): Action => ({
    id: "a1",
    text: "Fix heat map bug",
    done: false,
    at: 1000,
    shelf: "keep",
    expires: null,
    ...over,
  });

  it("carries the original when it says more than the card", () => {
    /* "Fix heat map bug" tells a model nothing; the sentence it came from
       says what is actually wrong. */
    const out = shareAction(
      act({ src: "Heat map seems off: some months are too close together." })
    );
    expect(out.text).toContain("Fix heat map bug");
    expect(out.text).toContain("Context:");
    expect(out.text).toContain("some months are too close together");
  });

  it("does not paste the same sentence twice over a full stop", () => {
    /* The sorter routinely hands back the capture with punctuation added. */
    const out = shareAction(
      act({ text: "Buy running clothes", src: "Buy running clothes." })
    );
    expect(out.text).toBe("Buy running clothes");
    expect(out.text).not.toContain("Context:");
  });

  it("includes a deadline, since it is the first thing anyone asks", () => {
    const out = shareAction(act({ due: Date.UTC(2026, 7, 22) }));
    expect(out.text).toContain("Due:");
  });

  it("stays plain text — this gets pasted into a chat box", () => {
    const out = shareAction(act({ src: "something longer entirely" }));
    expect(out.text.startsWith("#")).toBe(false);
  });
});

describe("a thread travels with its actions", () => {
  it("appends open then done, and nothing when there are none", async () => {
    const { shareThread } = await import("./share");
    const t = { id: "t", name: "Pricing", summary: "", frags: [{ id: "f", at: 1, text: "x" }] } as import("./model").Thread;
    const a = (id: string, done = false) =>
      ({ id, text: id, done, at: 1, imgs: [], shelf: "keep", expires: null }) as import("./model").Action;
    const out = shareThread(t, { open: [a("call the bank")], done: [a("ship it", true)] });
    expect(out.text).toContain("## Actions from this thread");
    expect(out.text).toContain("- [ ] call the bank");
    expect(out.text).toContain("- [x] ship it");
    expect(shareThread(t, { open: [], done: [] }).text).not.toContain("Actions from");
  });
});

describe("the record as a document", () => {
  it("names destinations, marks undone, caps the rows", async () => {
    const { shareRecord } = await import("./share");
    const e = (id: string, over: object) =>
      ({ id, at: 1, raw: "r", clean: "c", kind: "action", source: "typed", targetId: "", ...over }) as import("./ledger").CaptureEntry;
    const out = shareRecord(
      [
        e("1", { kind: "both", targetId: "t1", clean: "fix the bug", at: 3 }),
        e("2", { undone: true, clean: "oops", at: 2 }),
        e("3", { clean: "old", at: 1 }),
      ],
      [{ id: "t1", name: "Pricing" }],
      2
    );
    expect(out.text).toContain('in "Pricing": fix the bug');
    expect(out.text).toContain("undone");
    expect(out.text).not.toContain("old");
  });
});
