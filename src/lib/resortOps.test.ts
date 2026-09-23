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

  it("collapses secondary destinations, relinks their actions, and moves the image owner to the retained thread", () => {
    const sorted: SortResult = {
      kind: "both",
      title: "Several subjects",
      clean: "Primary thought. Secondary thought. Do both. Call mom.",
      actions: ["Do primary", "Do secondary", "Call mom"],
      actionMeta: [
        { text: "Do primary", source: "Do primary", shelfLife: "days", due: null, thinkingIndex: 0 },
        { text: "Do secondary", source: "Do secondary", shelfLife: "days", due: null, thinkingIndex: 1 },
        { text: "Call mom", source: "Call mom.", shelfLife: "days", due: null, thinkingIndex: null },
      ],
      primaryActions: ["Do primary"],
      primaryText: "Primary thought.",
      primaryOwnsImages: false,
      shelfLife: "keep",
      threadId: "model-thread",
      threadName: "Model thread",
      also: [{
        text: "Secondary thought.",
        threadId: "other",
        threadName: null,
        actions: ["Do secondary"],
        ownsImages: true,
      }],
    };
    const latest: Board = {
      ...board,
      threads: [
        ...board.threads,
        { id: "other", name: "Other", summary: "", frags: [] },
      ],
    };
    const pinned = pinResortDestination(sorted, waiting, latest)!;
    expect(pinned).toMatchObject({
      threadId: "home",
      threadName: null,
      primaryText: "Primary thought.\n\nSecondary thought.",
      primaryActions: ["Do primary", "Do secondary"],
      primaryOwnsImages: true,
      also: null,
    });
    expect(pinned.actionMeta?.map((action) => action.thinkingIndex)).toEqual([0, 0, null]);

    const applied = applySorted(pinned, ["image"], waiting.at, {
      ...latest,
      actions: [],
    });
    const owner = applied.next.threads.find((thread) => thread.id === "home")!.frags[0];
    expect(owner.imgs).toEqual(["image"]);
    expect(applied.next.threads.find((thread) => thread.id === "other")!.frags).toEqual([]);
    expect(applied.next.actions.find((action) => action.text === "Do primary"))
      .toMatchObject({ threadId: "home", sourceFragId: owner.id });
    expect(applied.next.actions.find((action) => action.text === "Do secondary"))
      .toMatchObject({ threadId: "home", sourceFragId: owner.id });
    expect(applied.next.actions.find((action) => action.text === "Call mom")?.threadId).toBeUndefined();
  });

  it("relinks an action-only retry and its shot to the retained destination", () => {
    const sorted: SortResult = {
      kind: "action",
      title: "Save receipt",
      clean: "Save the receipt.",
      actions: ["Save the receipt"],
      actionMeta: [{
        text: "Save the receipt",
        source: "Save the receipt.",
        shelfLife: "days",
        due: null,
        thinkingIndex: null,
      }],
      primaryOwnsImages: true,
    };
    const pinned = pinResortDestination(sorted, { ...waiting, imgs: ["image"] }, board)!;
    const applied = applySorted(pinned, ["image"], waiting.at, { ...board, actions: [] });
    const action = applied.next.actions[0];
    const owner = applied.next.threads.find((thread) => thread.id === "home")!.frags[0];
    expect(pinned).toMatchObject({ kind: "both", threadId: "home", primaryOwnsImages: true });
    expect(action).toMatchObject({ threadId: "home", sourceFragId: owner.id });
    expect(owner.imgs).toEqual(["image"]);
  });

  it("rejects a retained destination deleted from the latest board", () => {
    expect(pinResortDestination({
      kind: "thread",
      title: "Words",
      clean: waiting.text,
      threadId: null,
    }, waiting, { ...board, threads: [] })).toBeNull();
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
