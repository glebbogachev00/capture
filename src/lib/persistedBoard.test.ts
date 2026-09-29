import { describe, expect, it } from "vitest";
import { EMPTY } from "./model";
import { parsePersistedBoard } from "./persistedBoard";

const liveAction = {
  id: "owned-action",
  text: "Owned action",
  done: false,
  at: 1,
  shelf: "keep" as const,
  expires: null,
  updatedAt: 1,
};

const settlement = {
  id: "settlement-authority",
  captureId: "capture",
  pendingId: "pending-row",
  revision: 1,
  settledBy: "manual" as const,
  artifacts: [{ kind: "action" as const, id: liveAction.id }],
};

const persisted = (over: Record<string, unknown> = {}) => ({
  ...EMPTY,
  principles: [],
  actions: [liveAction],
  routingSettlements: [settlement],
  ...over,
});

describe("persisted routing settlement authority", () => {
  it("accepts one exact live artifact authority", () => {
    expect(parsePersistedBoard(persisted())).not.toBeNull();
  });

  it.each([
    ["empty settlement id", { ...settlement, id: "" }],
    ["empty capture id", { ...settlement, captureId: "" }],
    ["empty pending id", { ...settlement, pendingId: "" }],
    ["control character coordinate", { ...settlement, pendingId: "pending\u0000row" }],
    ["zero revision", { ...settlement, revision: 0 }],
    ["fractional revision", { ...settlement, revision: 1.5 }],
    ["empty artifacts", { ...settlement, artifacts: [] }],
    ["empty artifact id", { ...settlement, artifacts: [{ kind: "action", id: "" }] }],
    ["unknown artifact kind", { ...settlement, artifacts: [{ kind: "principle", id: liveAction.id }] }],
    ["duplicate artifact coordinates", {
      ...settlement,
      artifacts: [
        { kind: "action", id: liveAction.id },
        { kind: "action", id: liveAction.id },
      ],
    }],
    ["artifact with no live owner", {
      ...settlement,
      artifacts: [{ kind: "action", id: "missing-action" }],
    }],
  ])("rejects %s", (_case, unsafe) => {
    expect(parsePersistedBoard(persisted({ routingSettlements: [unsafe] }))).toBeNull();
  });

  it("rejects duplicate settlement identities", () => {
    expect(parsePersistedBoard(persisted({
      routingSettlements: [settlement, { ...settlement }],
    }))).toBeNull();
  });

  it("rejects an ambiguous fragment coordinate that cannot prove a unique live owner", () => {
    const frag = { id: "shared-frag", at: 1, text: "Ambiguous", updatedAt: 1 };
    expect(parsePersistedBoard(persisted({
      actions: [],
      threads: [
        { id: "one", name: "One", summary: "", frags: [frag], updatedAt: 1 },
        { id: "two", name: "Two", summary: "", frags: [frag], updatedAt: 1 },
      ],
      routingSettlements: [{
        ...settlement,
        artifacts: [{ kind: "frag", id: frag.id }],
      }],
    }))).toBeNull();
  });

  it.each([
    ["empty retirement capture", { captureId: "", pendingId: "pending", revision: 1, retiredAt: 1 }],
    ["unsafe retirement slot", { captureId: "capture", pendingId: "pending\u0000row", revision: 1, retiredAt: 1 }],
    ["invalid retirement revision", { captureId: "capture", pendingId: "pending", revision: 0, retiredAt: 1 }],
    ["invalid retirement time", { captureId: "capture", pendingId: "pending", revision: 1, retiredAt: -1 }],
  ])("rejects %s", (_case, retirement) => {
    expect(parsePersistedBoard(persisted({
      routingRetirements: [retirement],
    }))).toBeNull();
  });

  it("rejects duplicate retirement slots", () => {
    const retirement = { captureId: "capture", pendingId: "pending", revision: 1, retiredAt: 1 };
    expect(parsePersistedBoard(persisted({
      routingRetirements: [retirement, { ...retirement, retiredAt: 2 }],
    }))).toBeNull();
  });
});
