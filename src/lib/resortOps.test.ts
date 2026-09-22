import { describe, expect, it } from "vitest";
import { applySorted, type SortResult } from "./boardOps";
import { EMPTY, type Action, type Board } from "./model";
import {
  matchingPendingAction,
  pinResortDestination,
  recordResortedCapture,
} from "./resortOps";

const waiting: Action = {
  id: "waiting",
  text: "Offline words",
  src: "Offline words",
  done: false,
  at: 10,
  shelf: "keep",
  expires: null,
  unsorted: true,
  threadId: "home",
  imgs: [],
};

const board: Board = {
  ...EMPTY,
  principles: [],
  actions: [waiting],
  threads: [{ id: "home", name: "Home", summary: "", frags: [] }],
  ledger: [{
    id: "pending-record",
    captureId: "capture",
    at: 10,
    raw: waiting.text,
    clean: waiting.text,
    kind: "pending",
    source: "typed",
    targetId: waiting.id,
  }],
};

describe("resort operations", () => {
  it("rejects a stale envelope after an edit or deletion", () => {
    expect(matchingPendingAction(board, waiting)).toEqual(waiting);
    expect(matchingPendingAction({
      ...board,
      actions: [{ ...waiting, text: "Edited", src: "Edited" }],
    }, waiting)).toBeUndefined();
    expect(matchingPendingAction({ ...board, actions: [] }, waiting)).toBeUndefined();
  });

  it("pins every retry kind to the explicitly selected thread", () => {
    const sorted: SortResult = {
      kind: "action",
      title: "Tasks",
      clean: waiting.text,
      actions: ["One task"],
      shelfLife: "keep",
      threadId: "model-thread",
      threadName: "Model thread",
    };
    expect(pinResortDestination(sorted, waiting)).toMatchObject({
      threadId: "home",
      threadName: null,
    });
  });

  it("preserves the selected thread on text-only actions and returns every summary target", () => {
    const out: SortResult = {
      kind: "action",
      title: "Tasks",
      clean: waiting.text,
      actions: ["One task", "Another task"],
      shelfLife: "keep",
      threadId: "home",
      threadName: null,
    };
    const withoutEnvelope = { ...board, actions: [] };
    const applied = applySorted(out, [], waiting.at, withoutEnvelope);
    let id = 0;
    const recorded = recordResortedCapture(
      applied,
      out,
      waiting,
      board.ledger[0],
      () => `ledger-${++id}`,
    );

    expect(recorded.board.actions).toHaveLength(2);
    expect(recorded.board.actions.every((action) => action.threadId === "home")).toBe(true);
    expect(recorded.summaryTargets).toEqual(["home"]);
    expect(recorded.summaryTargets).not.toContain(recorded.board.actions[0].id);
  });

  it("returns primary and secondary thread summaries after a split retry", () => {
    const splitBoard: Board = {
      ...board,
      actions: [],
      threads: [
        ...board.threads,
        { id: "other", name: "Other", summary: "", frags: [] },
      ],
    };
    const out: SortResult = {
      kind: "thread",
      title: "Home",
      clean: "Primary words. Other words.",
      primaryText: "Primary words.",
      actions: [],
      threadId: "home",
      threadName: null,
      also: [{ text: "Other words.", threadId: "other", threadName: null }],
    };
    const applied = applySorted(out, [], waiting.at, splitBoard);
    let id = 0;
    const recorded = recordResortedCapture(
      applied,
      out,
      waiting,
      board.ledger[0],
      () => `ledger-${++id}`,
    );

    expect(new Set(recorded.summaryTargets)).toEqual(new Set(["home", "other"]));
  });
});
