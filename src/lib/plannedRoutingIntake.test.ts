import { describe, expect, it } from "vitest";
import { EMPTY, type Board } from "./model";
import type { PlannedRoutingPlan } from "./plannedRouting";
import {
  parsePlannedRoutingResponse,
  reconcilePersistedComposerImages,
  stagePlannedRoutingIntake,
} from "./plannedRoutingIntake";

const raw = "Keep the exact rough thought.";
const board: Board = {
  ...EMPTY,
  principles: [],
  threads: [{ id: "open-thread", name: "Open Thread", summary: "", frags: [] }],
};

const recovery = {
  clean: raw,
  kind: "action" as const,
  title: "Rough thought",
  actions: [raw],
  primaryActions: [],
  shelfLife: "keep",
  due: null,
  threadId: null,
  threadName: null,
  primaryText: null,
  also: [],
};

const plan: PlannedRoutingPlan = {
  items: [{
    id: "action-one",
    source: raw,
    kind: "action",
    action: raw,
    due: null,
    ownerId: null,
    destinations: [],
    duplicateActionId: null,
    unresolved: false,
    ambiguity: null,
  }],
  newThreads: [],
};

describe("planned routing durable intake", () => {
  it("remints a same-id composer edit after the original bytes become durable", () => {
    expect(reconcilePersistedComposerImages(
      [{ id: "photo", src: "edited-bytes" }],
      [{ id: "photo", src: "original-bytes" }],
      () => "reminted-photo",
    )).toEqual([{ id: "reminted-photo", src: "edited-bytes" }]);
  });

  it("stages one exact pending envelope with immutable identity, revision and origin", () => {
    const staged = stagePlannedRoutingIntake(board, {
      captureId: "capture-one",
      raw,
      payload: raw,
      transcript: "Keep the exact, um, rough thought.",
      images: [{ id: "photo-one", src: "data:image/png;base64,bytes" }],
      at: 1234,
      dictated: true,
      openThreadId: "open-thread",
    }, { itemId: "pending-one", ledgerId: "ledger-one" });

    expect(staged).toMatchObject({
      captureId: "capture-one",
      revision: 1,
      imageEntries: [["capture:img:photo-one", "data:image/png;base64,bytes"]],
    });
    expect(staged.board.actions).toEqual([
      expect.objectContaining({
        id: "pending-one",
        text: raw,
        src: raw,
        imgs: ["photo-one"],
        threadId: "open-thread",
        unsorted: true,
        pendingRevision: 1,
      }),
    ]);
    expect(staged.board.ledger).toEqual([
      expect.objectContaining({
        id: "ledger-one",
        captureId: "capture-one",
        pendingRevision: 1,
        raw,
        clean: raw,
        transcript: "Keep the exact, um, rough thought.",
        imgs: ["photo-one"],
        openThreadId: "open-thread",
        at: 1234,
        source: "dictated",
        kind: "pending",
        targetId: "pending-one",
      }),
    ]);
  });

  it("accepts only a complete validated-plan response for the exact capture", () => {
    expect(parsePlannedRoutingResponse({
      planned: true,
      captureId: "capture-one",
      routingPlan: plan,
      recovery,
      via: "synthetic",
    }, "capture-one")).toEqual({ routingPlan: plan, recovery, via: "synthetic" });

    expect(parsePlannedRoutingResponse({
      planned: true,
      captureId: "another-capture",
      routingPlan: plan,
      recovery,
    }, "capture-one")).toBeNull();
    expect(parsePlannedRoutingResponse({
      planned: true,
      captureId: "capture-one",
      recovery,
    }, "capture-one")).toBeNull();
    expect(parsePlannedRoutingResponse({
      planned: true,
      captureId: "capture-one",
      routingPlan: { items: [], newThreads: [] },
      recovery,
    }, "capture-one")).toBeNull();
  });
});
