import type { Action, Board } from "./model";
import type { DurableMutation, DurableMutationResult } from "./durableBoardCommit";
import {
  settleManualRoutingForAction,
  snapshotManualPending,
  type ManualDestination,
  type ManualPendingSnapshot,
  type ManualRoutingResult,
} from "./manualRoutingSettlement";
import {
  settleManualSplitForAction,
  type ManualSplitResult,
  type ManualSplitSegment,
} from "./manualSplitSettlement";
import type { PlannedSortAuthority } from "./plannedSortAuthority";
import type { Tombstone } from "./sync";
import {
  buildManualRoutingUndo,
  MANUAL_ROUTING_UNDO_KEY,
  type ManualRoutingUndo,
} from "./manualRoutingUndo";

type Transact = <T>(
  build: (current: Board, currentTombstones: Tombstone[]) => DurableMutation<T>,
) => Promise<DurableMutationResult<T>>;

type ManualRoutingOperationsOptions = {
  read: () => Board;
  authority: PlannedSortAuthority;
  transact: Transact;
  now: () => number;
  fail: (message: string) => void;
  staleDestination: () => void;
  routingApplied: (
    shown: Action,
    captureId: string,
    settled: Extract<ManualRoutingResult, { status: "applied" }>,
    board: Board,
    undo: ManualRoutingUndo,
  ) => void;
  splitApplied: (
    shown: Action,
    captureId: string,
    settled: Extract<ManualSplitResult, { status: "applied" }>,
    board: Board,
  ) => void;
};

/** Share the capture-level authority and durable transaction protocol between
 * ordinary manual filing and P4.2 split filing. UI consequences remain in the
 * hook callbacks; this module owns only transition admission and truthfulness. */
export function createManualRoutingOperations(options: ManualRoutingOperationsOptions) {
  const manualSort = async (shown: Action, destination: ManualDestination) => {
    const snapshot = snapshotManualPending(options.read().ledger, shown);
    if (!snapshot) return false;
    const captureId = snapshot.captureId;
    const owner = options.authority.claim(captureId);
    if (!owner) return false;
    try {
      const durable = await options.transact<{
        settled: Extract<ManualRoutingResult, { status: "applied" }>;
        undo: ManualRoutingUndo;
      } | ManualRoutingResult | null>((current, currentTombstones) => {
        const settled = settleManualRoutingForAction(current, snapshot, destination, options.now());
        if (!settled || settled.status !== "applied") return { skip: settled };
        const destinationLabel = settled.target.kind === "action"
          ? "Actions"
          : settled.target.kind === "intention"
            ? "Intentions"
            : settled.board.threads.find((thread) => thread.id === settled.target.id)?.name || "Threads";
        const value = { settled, undo: buildManualRoutingUndo(
          current, currentTombstones, snapshot, settled, destinationLabel,
        ) };
        return {
          next: settled.board,
          tombstones: settled.tombstones,
          entries: (prepared) => {
            value.undo = buildManualRoutingUndo(current, currentTombstones, snapshot,
              { ...settled, ...prepared }, destinationLabel);
            return [[MANUAL_ROUTING_UNDO_KEY, JSON.stringify(value.undo)]];
          },
          value,
        };
      });
      if (durable.status === "failed") {
        options.fail("Couldn't save that choice. It is still safely Unsorted.");
        return false;
      }
      if (durable.status === "skipped") {
        if (durable.value && "status" in durable.value &&
          durable.value.status === "conflict" && durable.value.reason === "stale_destination") {
          options.staleDestination();
        }
        return false;
      }
      if (!durable.value || "status" in durable.value) return false;
      options.authority.cancel(captureId);
      options.routingApplied(
        shown, captureId, durable.value.settled, durable.board, durable.value.undo,
      );
      return true;
    } finally {
      options.authority.release(captureId, owner);
    }
  };

  const manualSplit = async (
    shown: Action,
    segments: ManualSplitSegment[],
    snapshot: ManualPendingSnapshot,
  ) => {
    if (shown.id !== snapshot.targetId) return false;
    const captureId = snapshot.captureId;
    const owner = options.authority.claim(captureId);
    if (!owner) return false;
    try {
      const durable = await options.transact<ManualSplitResult | null>((current) => {
        const settled = settleManualSplitForAction(current, snapshot, segments, options.now());
        return settled.status === "applied"
          ? { next: settled.board, tombstones: settled.tombstones, value: settled }
          : { skip: settled };
      });
      if (durable.status === "failed") {
        options.fail("Couldn't save that split. It is still safely Unsorted.");
        return false;
      }
      if (durable.status === "skipped") {
        if (durable.value?.status === "conflict" && durable.value.reason === "stale_destination") {
          options.staleDestination();
        }
        return false;
      }
      if (!durable.value || durable.value.status !== "applied") return false;
      options.authority.cancel(captureId);
      options.splitApplied(shown, captureId, durable.value, durable.board);
      return true;
    } finally {
      options.authority.release(captureId, owner);
    }
  };

  return { manualSort, manualSplit };
}
