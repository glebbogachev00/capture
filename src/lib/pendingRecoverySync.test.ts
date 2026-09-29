import { describe, expect, it } from "vitest";
import { EMPTY, hydrate, type Board } from "./model";
import { parsePersistedBoard } from "./persistedBoard";
import { appendLedger, LEDGER_CAP } from "./ledger";
import { stagePlannedRoutingIntake } from "./plannedRoutingIntake";
import { settleManualRouting } from "./manualRoutingSettlement";
import { settlePlannedRouting } from "./plannedRoutingSettlement";
import type { PlannedRoutingPlan } from "./plannedRouting";
import { mergeSync, TOMBSTONE_TTL, type SyncState } from "./sync";
import { stampChanges } from "./sync";
import { prepareResortedCapture } from "./resortOps";

const source = "Cross-device manual authority";

function pendingBoard(): Board {
  return stagePlannedRoutingIntake({ ...EMPTY, principles: [] }, {
    captureId: "capture-cross-device",
    raw: source,
    payload: source,
    images: [{ id: "cross-device-image", src: "data:image/png;base64,bytes" }],
    at: 100,
    dictated: false,
  }, { itemId: "pending-target", ledgerId: "pending-row" }).board;
}

const plan: PlannedRoutingPlan = {
  items: [{
    id: "automatic-action",
    source,
    kind: "action",
    action: source,
    due: null,
    ownerId: null,
    destinations: [],
    duplicateActionId: null,
    unresolved: false,
    ambiguity: null,
  }],
  newThreads: [],
};

const recovery = {
  clean: source,
  kind: "action" as const,
  title: source,
  actions: [source],
  primaryActions: [],
  shelfLife: "keep",
  due: null,
  threadId: null,
  threadName: null,
  primaryText: null,
  also: [],
};

function competingStates() {
  const pending = pendingBoard();
  const manual = settleManualRouting(pending, {
    captureId: "capture-cross-device",
    pendingId: "pending-row",
    pendingTargetId: "pending-target",
    pendingSource: source,
    pendingImageIds: ["cross-device-image"],
    pendingInputSource: "typed",
    revision: 1,
    destination: { kind: "action" },
    now: 200,
  });
  const automatic = settlePlannedRouting(pending, {
    captureId: "capture-cross-device",
    revision: 1,
    plan,
    recovery,
    now: 250,
  });
  if (manual.status !== "applied" || automatic.status !== "applied") {
    throw new Error("fixture settlement failed");
  }
  return {
    manual: { board: manual.board, tombstones: manual.tombstones } satisfies SyncState,
    automatic: { board: automatic.board, tombstones: automatic.tombstones } satisfies SyncState,
  };
}

function activeSettlements(board: Board) {
  return board.ledger.filter((entry) =>
    (entry.captureId ?? entry.id) === "capture-cross-device" &&
    entry.kind !== "pending" &&
    !entry.undone
  );
}

describe("cross-device pending recovery authority", () => {
  it.each(["manual-first", "automatic-first"])(
    "manual settlement defeats an already-landed stale automatic result in %s merge order",
    (order) => {
      const states = competingStates();
      const merged = order === "manual-first"
        ? mergeSync(states.manual, states.automatic, 300)
        : mergeSync(states.automatic, states.manual, 300);

      const repeated = mergeSync(merged, states.automatic, 350);
      expect(repeated.board.actions.filter((action) => !action.unsorted)).toEqual([
        expect.objectContaining({
          id: "manual:capture-cross-device:pending-row:r1:action",
          text: source,
        }),
      ]);
      expect(activeSettlements(repeated.board)).toEqual([
        expect.objectContaining({ settledBy: "manual" }),
      ]);
      expect(repeated.board.actions.some((action) => action.id === "pending-target")).toBe(false);
      expect(repeated.board.ledger.find((entry) => entry.id === "pending-row"))
        .toMatchObject({ undone: true });
    },
  );

  it("sync carries one pending image reference without classifying or duplicating it", () => {
    const local = { board: pendingBoard(), tombstones: [] } satisfies SyncState;
    const remote = { board: { ...EMPTY, principles: [] }, tombstones: [] } satisfies SyncState;
    const merged = mergeSync(remote, local, 150);

    expect(merged.board.actions).toEqual([
      expect.objectContaining({ id: "pending-target", imgs: ["cross-device-image"], unsorted: true }),
    ]);
    expect(merged.board.ledger).toEqual([
      expect.objectContaining({ id: "pending-row", imgs: ["cross-device-image"], kind: "pending" }),
    ]);
  });

  it("manual settlement removes every artifact from a stale image-aware automatic landing", () => {
    const pending = pendingBoard();
    const manual = settleManualRouting(pending, {
      captureId: "capture-cross-device",
      pendingId: "pending-row",
      pendingTargetId: "pending-target",
      pendingSource: source,
      pendingImageIds: ["cross-device-image"],
      pendingInputSource: "typed",
      revision: 1,
      destination: { kind: "action" },
      now: 200,
    });
    let id = 0;
    const automatic = prepareResortedCapture(pending, pending.actions[0], {
      clean: source,
      kind: "action",
      title: source,
      actions: [source],
      shelfLife: "keep",
      due: null,
      threadId: null,
      threadName: null,
      primaryText: null,
      also: [],
    }, () => `automatic-${++id}`);
    if (manual.status !== "applied" || !automatic || automatic.kind !== "settled") {
      throw new Error("fixture settlement failed");
    }
    const stamped = stampChanges(pending, automatic.board, 250);
    const merged = mergeSync(
      { board: manual.board, tombstones: manual.tombstones },
      { board: stamped.board, tombstones: stamped.tombstones },
      300,
    );

    expect(merged.board.actions.filter((action) => !action.unsorted))
      .toEqual([expect.objectContaining({ id: "manual:capture-cross-device:pending-row:r1:action" })]);
    expect(merged.board.threads).toEqual([
      expect.objectContaining({ id: "manual:capture-cross-device:pending-row:r1:image-thread" }),
    ]);
    expect(activeSettlements(merged.board)).toEqual([
      expect.objectContaining({ settledBy: "manual" }),
    ]);
  });

  it.each(["manual-first", "automatic-first"])(
    "manual authority removes a stale automatic partial remainder in %s merge order and on repeated sync",
    (order) => {
      const partialSource = "Keep the understood action. Leave this remainder unresolved.";
      const pending = stagePlannedRoutingIntake({ ...EMPTY, principles: [] }, {
        captureId: "capture-partial-race",
        raw: partialSource,
        payload: partialSource,
        images: [{ id: "partial-image", src: "data:image/png;base64,bytes" }],
        at: 400,
        dictated: false,
      }, { itemId: "partial-target", ledgerId: "partial-row" }).board;
      const manual = settleManualRouting(pending, {
        captureId: "capture-partial-race",
        pendingId: "partial-row",
        pendingTargetId: "partial-target",
        pendingSource: partialSource,
        pendingImageIds: ["partial-image"],
        pendingInputSource: "typed",
        revision: 1,
        destination: { kind: "action" },
        now: 450,
      });
      const automatic = settlePlannedRouting(pending, {
        captureId: "capture-partial-race",
        revision: 1,
        plan: {
          items: [
            {
              id: "understood",
              source: "Keep the understood action. ",
              kind: "action",
              action: "Keep the understood action",
              due: null,
              ownerId: null,
              destinations: [],
              duplicateActionId: null,
              unresolved: false,
              ambiguity: null,
            },
            {
              id: "remainder",
              source: "Leave this remainder unresolved.",
              kind: "action",
              action: "Leave this remainder unresolved",
              due: null,
              ownerId: null,
              destinations: [],
              duplicateActionId: null,
              unresolved: true,
              ambiguity: "No safe destination.",
            },
          ],
          newThreads: [],
        },
        recovery: {
          ...recovery,
          clean: partialSource,
          title: partialSource,
          actions: ["Keep the understood action", "Leave this remainder unresolved"],
        },
        now: 500,
      });
      if (manual.status !== "applied" || automatic.status !== "applied") {
        throw new Error("partial fixture settlement failed");
      }
      const manualState = { board: manual.board, tombstones: manual.tombstones };
      const automaticState = { board: automatic.board, tombstones: automatic.tombstones };
      const merged = order === "manual-first"
        ? mergeSync(manualState, automaticState, 550)
        : mergeSync(automaticState, manualState, 550);
      const repeated = mergeSync(merged, automaticState, 600);

      expect(repeated.board.actions).toEqual([
        expect.objectContaining({
          id: "manual:capture-partial-race:partial-row:r1:action",
        }),
      ]);
      expect(repeated.board.actions.some((action) => action.unsorted)).toBe(false);
      expect(repeated.board.ledger.find((entry) =>
        entry.id === "planned:capture-partial-race:ledger-pending:remainder"
      )).toMatchObject({
        settledBy: "automatic",
        settlementPendingId: "partial-row",
        settlementRevision: 1,
        undone: true,
      });
    },
  );

  it.each(["manual-first", "automatic-first"])(
    "keeps manual authority after both settlement ledger rows age out in %s merge order",
    (order) => {
      const states = competingStates();
      const ageOut = (input: Board): Board => {
        let ledger = input.ledger;
        for (let index = 0; index <= LEDGER_CAP; index += 1) {
          ledger = appendLedger(ledger, {
            id: `newer-${index}`,
            at: 10_000 + index,
            raw: `newer ${index}`,
            clean: `newer ${index}`,
            kind: "action",
            source: "typed",
            targetId: `newer-action-${index}`,
          });
        }
        return { ...input, ledger };
      };
      const manual = { ...states.manual, board: ageOut(states.manual.board) };
      const automatic = { ...states.automatic, board: ageOut(states.automatic.board) };
      expect(activeSettlements(manual.board)).toEqual([]);
      expect(activeSettlements(automatic.board)).toEqual([]);

      const merged = order === "manual-first"
        ? mergeSync(manual, automatic, 20_000)
        : mergeSync(automatic, manual, 20_000);
      const repeated = mergeSync(merged, automatic, 20_001);

      expect(repeated.board.actions.filter((action) =>
        action.id.includes("capture-cross-device")
      )).toEqual([
        expect.objectContaining({ id: "manual:capture-cross-device:pending-row:r1:action" }),
      ]);
      expect(repeated.board.routingSettlements).toEqual([
        expect.objectContaining({
          settledBy: "manual",
          pendingId: "pending-row",
          revision: 1,
        }),
      ]);
    },
  );

  it.each(["retired-first", "stale-first"] as const)(
    "keeps a manual win retired after its last artifact, authority row, and ledger history are gone in %s order",
    (order) => {
      const states = competingStates();
      const manualCoordinates = new Set(
        (states.manual.board.routingSettlements ?? [])
          .filter((record) => record.settledBy === "manual")
          .flatMap((record) => record.artifacts)
          .map((artifact) => JSON.stringify([artifact.kind, artifact.id])),
      );
      const removedManualArtifacts: Board = {
        ...states.manual.board,
        actions: states.manual.board.actions.filter((item) =>
          !manualCoordinates.has(JSON.stringify(["action", item.id]))
        ),
        threads: states.manual.board.threads
          .filter((item) => !manualCoordinates.has(JSON.stringify(["thread", item.id])))
          .map((thread) => ({
            ...thread,
            frags: thread.frags.filter((item) =>
              !manualCoordinates.has(JSON.stringify(["frag", item.id]))
            ),
          })),
        intentions: states.manual.board.intentions.filter((item) =>
          !manualCoordinates.has(JSON.stringify(["intention", item.id]))
        ),
      };
      const deleted = stampChanges(states.manual.board, removedManualArtifacts, 500);
      let ledger = deleted.board.ledger;
      for (let index = 0; index <= LEDGER_CAP; index += 1) {
        ledger = appendLedger(ledger, {
          id: `retirement-newer-${index}`,
          at: 10_000 + index,
          raw: `newer ${index}`,
          clean: `newer ${index}`,
          kind: "action",
          source: "typed",
          targetId: `retirement-action-${index}`,
        });
      }
      const retired = { ...deleted, board: { ...deleted.board, ledger } };
      expect(retired.board.routingSettlements).toEqual([]);
      expect(retired.board.routingRetirements).toEqual([
        expect.objectContaining({
          captureId: "capture-cross-device",
          pendingId: "pending-row",
          revision: 1,
        }),
      ]);

      const parsed = parsePersistedBoard(JSON.parse(JSON.stringify(retired.board)));
      expect(parsed).not.toBeNull();
      const reloaded = { board: hydrate(parsed!), tombstones: retired.tombstones };
      const merged = order === "retired-first"
        ? mergeSync(reloaded, states.automatic, 600)
        : mergeSync(states.automatic, reloaded, 600);
      const repeated = mergeSync(merged, states.automatic, 700);
      expect(repeated.board.actions.some((item) =>
        item.id === "planned:capture-cross-device:action:automatic-action"
      )).toBe(false);
      expect(repeated.board.routingRetirements).toEqual([
        expect.objectContaining({ retiredAt: 700 }),
      ]);

      const nextRevision: SyncState = {
        board: {
          ...EMPTY,
          principles: [],
          actions: [{
            id: "legitimate-revision-two",
            text: "Legitimate revision two",
            done: false,
            at: 800,
            updatedAt: 800,
            shelf: "keep",
            expires: null,
          }],
          routingSettlements: [{
            id: "revision-two-authority",
            captureId: "capture-cross-device",
            pendingId: "pending-row",
            revision: 2,
            settledBy: "automatic",
            artifacts: [{ kind: "action", id: "legitimate-revision-two" }],
          }],
        },
        tombstones: [],
      };
      const withNextRevision = mergeSync(repeated, nextRevision, 800);
      expect(withNextRevision.board.actions.some((item) =>
        item.id === "legitimate-revision-two"
      )).toBe(true);

      const compacted = mergeSync(
        withNextRevision,
        { board: { ...EMPTY, principles: [] }, tombstones: [] },
        700 + TOMBSTONE_TTL + 1,
      );
      expect(compacted.board.routingRetirements).toEqual([]);
    },
  );

  it.each([
    ["a-first", "manual-first", false],
    ["a-first", "automatic-first", false],
    ["b-first", "manual-first", false],
    ["b-first", "automatic-first", false],
    ["a-first", "manual-first", true],
    ["a-first", "automatic-first", true],
    ["b-first", "manual-first", true],
    ["b-first", "automatic-first", true],
  ] as const)(
    "retires both distinct automatic artifact sets after %s automatic merge, %s winner merge, ledgerEvicted=%s",
    (automaticOrder, winnerOrder, ledgerEvicted) => {
      const pending = pendingBoard();
      const settleAutomatic = (itemId: string, now: number) => {
        const result = settlePlannedRouting(pending, {
          captureId: "capture-cross-device",
          revision: 1,
          plan: {
            ...plan,
            items: [{ ...plan.items[0], id: itemId }],
          },
          recovery,
          now,
        });
        if (result.status !== "applied") throw new Error("automatic fixture settlement failed");
        return { board: result.board, tombstones: result.tombstones } satisfies SyncState;
      };
      const automaticA = settleAutomatic("automatic-a", 210);
      const automaticB = settleAutomatic("automatic-b", 220);
      const manualResult = settleManualRouting(pending, {
        captureId: "capture-cross-device",
        pendingId: "pending-row",
        pendingTargetId: "pending-target",
        pendingSource: source,
        pendingImageIds: ["cross-device-image"],
        pendingInputSource: "typed",
        revision: 1,
        destination: { kind: "action" },
        now: 230,
      });
      if (manualResult.status !== "applied") throw new Error("manual fixture settlement failed");
      const manual = {
        board: manualResult.board,
        tombstones: manualResult.tombstones,
      } satisfies SyncState;
      let automatic = automaticOrder === "a-first"
        ? mergeSync(automaticA, automaticB, 300)
        : mergeSync(automaticB, automaticA, 300);
      if (ledgerEvicted) {
        let ledger = automatic.board.ledger;
        for (let index = 0; index <= LEDGER_CAP; index += 1) {
          ledger = appendLedger(ledger, {
            id: `concurrent-newer-${index}`,
            at: 10_000 + index,
            raw: `newer ${index}`,
            clean: `newer ${index}`,
            kind: "action",
            source: "typed",
            targetId: `newer-action-${index}`,
          });
        }
        automatic = { ...automatic, board: { ...automatic.board, ledger } };
      }

      const won = winnerOrder === "manual-first"
        ? mergeSync(manual, automatic, 400)
        : mergeSync(automatic, manual, 400);
      expect(won.board.actions.some((action) =>
        action.id === "planned:capture-cross-device:action:automatic-a" ||
        action.id === "planned:capture-cross-device:action:automatic-b"
      )).toBe(false);
      const repeatedA = mergeSync(won, automaticA, 500);
      const repeatedB = mergeSync(repeatedA, automaticB, 600);

      expect(repeatedB.board.actions.filter((action) => !action.unsorted)).toEqual([
        expect.objectContaining({ id: "manual:capture-cross-device:pending-row:r1:action" }),
      ]);
      expect(repeatedB.board.actions.some((action) =>
        action.id === "planned:capture-cross-device:action:automatic-a" ||
        action.id === "planned:capture-cross-device:action:automatic-b"
      )).toBe(false);
    },
  );
});
