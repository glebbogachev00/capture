import { describe, expect, it } from "vitest";
import type { Action, Board, Thread } from "./model";
import { actionsForThread } from "./threadActions";

/**
 * Taken from Gleb's real board, 2026-08-27, where the same errands were
 * appearing under threads they had nothing to do with. A thread showing no
 * actions is a small disappointment; a thread showing someone else's is
 * the app being wrong out loud.
 */
const action = (id: string, text: string): Action => ({
  id,
  text,
  done: false,
  at: 1,
  shelf: "keep",
  expires: null,
});

const thread = (id: string, name: string, frags: string[]): Thread => ({
  id,
  name,
  summary: "",
  frags: frags.map((text, i) => ({ id: `${id}-f${i}`, at: 1, text })),
});

const board = (actions: Action[], threads: Thread[]): Board => ({
  actions,
  threads,
  intentions: [],
  principles: [],
  ledger: [],
  corrections: [],
});

describe("a thread only claims actions that share a phrase with it", () => {
  it("does not borrow an errand over one incidental word", () => {
    // The thread mentions a girlfriend once, in passing, while talking
    // about AI agents. The errand is about lilies.
    const friction = thread("t1", "Reducing friction strategy", [
      "I should be able to access agents through the phone in a nice, responsive UI. For example, I want to order flowers for my girlfriend, find a dress, and create a media message.",
    ]);
    const b = board(
      [action("a1", "Give the caul lilies to my girlfriend")],
      [friction]
    );
    expect(actionsForThread(b, friction).open).toHaveLength(0);
  });

  it("does not put a portfolio errand under a bug tracker", () => {
    const bugs = thread("t2", "Bugs, Issues and Additions", [
      "The basic agentic infrastructure is in place but the app is still spitting out bugs. The heat map is showing up but the layout is off and sorting breaks after I resolve an action.",
    ]);
    const b = board(
      [
        action("a2", "Create a portfolio for Dom"),
        action("a3", "Mention to the parent that Dom has two lessons left"),
      ],
      [bugs]
    );
    expect(actionsForThread(b, bugs).open).toHaveLength(0);
  });

  it("still finds the action that is genuinely about the thread", () => {
    const bugs = thread("t3", "Bugs, Issues and Additions", [
      "Sorting breaks after I resolve an action, and the heat map layout is off.",
    ]);
    const b = board(
      [
        action("a4", "Fix the heat map layout on the board"),
        action("a5", "Give the caul lilies to my girlfriend"),
      ],
      [bugs]
    );
    const open = actionsForThread(b, bugs).open;
    expect(open.map((a) => a.id)).toEqual(["a4"]);
  });

  it("provenance still wins regardless of wording", () => {
    // A "both" capture made the action and the thread in one moment; it
    // belongs there even with no words in common.
    const t = thread("t4", "Pricing model", ["Usage-based versus seats."]);
    const a: Action = { ...action("a6", "Email the accountant"), threadId: "t4" };
    const b = board([a], [t]);
    expect(actionsForThread(b, t).open.map((x) => x.id)).toEqual(["a6"]);
  });
});
