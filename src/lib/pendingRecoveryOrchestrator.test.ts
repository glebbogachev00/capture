import { describe, expect, it, vi } from "vitest";
import { EMPTY, type Board } from "./model";
import {
  PENDING_RECOVERY_KEY,
  createPendingRecoveryRecord,
  exactPendingSnapshot,
  serializePendingRecoveryRecords,
} from "./pendingRecovery";
import { PendingRecoveryOrchestrator, type PendingRecoveryAccess } from "./pendingRecoveryOrchestrator";

const liveBoard = (): Board => ({
  ...EMPTY,
  principles: [],
  actions: [{
    id: "pending-target",
    text: "Keep this exact source",
    src: "Keep this exact source",
    done: false,
    at: 100,
    updatedAt: 100,
    shelf: "keep",
    expires: null,
    unsorted: true,
    pendingRevision: 1,
  }],
  ledger: [{
    id: "pending-row",
    captureId: "capture-one",
    at: 100,
    raw: "Keep this exact source",
    clean: "Keep this exact source",
    pendingSource: "Keep this exact source",
    kind: "pending",
    pendingRevision: 1,
    source: "typed",
    targetId: "pending-target",
  }],
});

function access(persist: PendingRecoveryAccess["persist"]): PendingRecoveryAccess {
  return {
    board: () => ({ ...EMPTY, principles: [] }),
    allowed: () => true,
    exclusive: (work) => work(),
    persist,
  };
}

describe("PendingRecoveryOrchestrator startup retirement", () => {
  it("persists stale loaded recovery records as an empty store", async () => {
    const orchestrator = new PendingRecoveryOrchestrator();
    const snapshot = exactPendingSnapshot(liveBoard(), "pending-target")!;
    orchestrator.load(serializePendingRecoveryRecords([
      createPendingRecoveryRecord(snapshot, 1, 100),
    ]), { ...EMPTY, principles: [] });
    const persist = vi.fn(async () => {});

    await orchestrator.prune(access(persist));

    expect(persist).toHaveBeenCalledWith(PENDING_RECOVERY_KEY, "[]");
  });

  it("keeps stale records in memory when persistence fails so a later wake retries retirement", async () => {
    const orchestrator = new PendingRecoveryOrchestrator();
    const snapshot = exactPendingSnapshot(liveBoard(), "pending-target")!;
    orchestrator.load(serializePendingRecoveryRecords([
      createPendingRecoveryRecord(snapshot, 1, 100),
    ]), { ...EMPTY, principles: [] });
    const persist = vi.fn()
      .mockRejectedValueOnce(new Error("disk unavailable"))
      .mockResolvedValueOnce(undefined);
    const options = access(persist);

    await expect(orchestrator.prune(options)).rejects.toThrow("disk unavailable");
    await orchestrator.wake({
      ...options,
      now: () => 1_000,
      online: () => true,
      run: vi.fn(),
    });

    expect(persist).toHaveBeenCalledTimes(2);
    expect(persist).toHaveBeenLastCalledWith(PENDING_RECOVERY_KEY, "[]");
  });
});
