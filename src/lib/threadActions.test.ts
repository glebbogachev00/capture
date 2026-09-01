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
      threads: [thread(), { ...thread(), id: "t2", name: "Other" }],
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
      threads: [thread()],
      actions: [action("a", { src: "ship the fix" })],
      ledger: [entry({ id: "e1", clean: "ship the fix", targetId: "t1" })],
    };
    expect(actionsForThread(b, thread()).open.map((a) => a.id)).toEqual(["a"]);
  });

  it("borrows an open action that shares the thread's subject", () => {
    const b: Board = {
      ...EMPTY,
      threads: [thread(), { ...thread(), id: "t2", name: "Other" }],
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
      threads: [thread()],
      actions: [action("a", { src: "ship the fix" })],
      ledger: [entry({ id: "e1", clean: "ship the fix", targetId: "t1", undone: true })],
    };
    expect(actionsForThread(b, thread()).open).toEqual([]);
  });
});

describe("after a partial restore", () => {
  it("an action naming a thread that did not come across is still claimable", async () => {
    const { actionsForThread } = await import("./threadActions");
    const { EMPTY } = await import("./model");
    const b = {
      ...EMPTY,
      actions: [
        { id: "a1", text: "Draft the usage-based pricing page", done: false, at: 1, imgs: [], shelf: "keep", expires: null, threadId: "gone" },
      ],
    } as Board;
    expect(actionsForThread(b, thread()).open.map((a) => a.id)).toEqual(["a1"]);
  });
});

describe("one telling word is not enough", () => {
  /* This used to assert the opposite. The rule it pinned put "Give the
     caul lilies to my girlfriend" under a thread about AI agents, because
     that thread mentioned a girlfriend once — see threadActions.board.test
     for the cases off the real board. A single shared word, however rare,
     is a coincidence often enough that the list stops being trustworthy,
     and a thread showing someone else's errand is worse than one showing
     none. */
  it("needs a phrase, not a rare word in common", async () => {
    const { actionsForThread } = await import("./threadActions");
    const { EMPTY } = await import("./model");
    const t = {
      ...thread(),
      summary: "Underwriters want the pricing model settled before pricing the tier.",
    };
    const b = {
      ...EMPTY,
      threads: [t],
      actions: [
        action("oneWord", { text: "Email the underwriters about the quote" }),
        action("phrase", { text: "Settle the pricing model this week" }),
      ],
    } as Board;
    const open = actionsForThread(b, t).open.map((a) => a.id);
    expect(open).not.toContain("oneWord");
    expect(open).toContain("phrase");
  });
});

describe("finished work is visible, for the agent reading the board", () => {
  it("a ticked action shows in done via its completion receipt", () => {
    /* A tick removes the row; the receipt is the surviving fact. Before
       this read the done list was always empty, so a share handed to an
       agent could not tell done from never-existed. */
    const board: Board = {
      ...EMPTY,
      actions: [],
      completions: [
        { id: "a-undo", text: "Add an undo button next to the edit wording button", at: 2000, threadId: "t1" },
        { id: "a-other", text: "Rotate the Upstash token", at: 3000 },
      ],
      threads: [thread()],
    };
    const t = board.threads[0];
    const { done } = actionsForThread(board, t);
    expect(done.map((d) => d.id)).toEqual(["a-undo"]);
    expect(done[0].text).toMatch(/undo button/);
  });
});
