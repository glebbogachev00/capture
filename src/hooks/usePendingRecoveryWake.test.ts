/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EMPTY, type Board } from "@/lib/model";
import {
  createPendingRecoveryRecord,
  exactPendingSnapshot,
  serializePendingRecoveryRecords,
} from "@/lib/pendingRecovery";
import { PendingRecoveryOrchestrator } from "@/lib/pendingRecoveryOrchestrator";
import { usePendingRecoveryWake } from "./usePendingRecoveryWake";

const board: Board = {
  ...EMPTY,
  principles: [],
  actions: [{
    id: "pending-target", text: "Said while walking", src: "Said while walking", done: false,
    at: 0, updatedAt: 0, shelf: "keep", expires: null, unsorted: true, pendingRevision: 1,
  }],
  ledger: [{
    id: "pending-row", captureId: "capture-one", at: 0, raw: "Said while walking", clean: "Said while walking",
    pendingSource: "Said while walking", kind: "pending", pendingRevision: 1, source: "typed", targetId: "pending-target",
  }],
};

let hidden = false;
Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (hidden ? "hidden" : "visible") });

function mount(nextAttemptAt: number, busy?: () => boolean) {
  const orchestrator = new PendingRecoveryOrchestrator();
  orchestrator.load(serializePendingRecoveryRecords([
    createPendingRecoveryRecord(exactPendingSnapshot(board, "pending-target")!, 1, nextAttemptAt),
  ]), board);
  const run = vi.fn(async () => {});
  renderHook(() => usePendingRecoveryWake({
    loaded: true, board, orchestrator, run, now: () => Date.now(), busy,
    access: () => ({ board: () => board, allowed: () => true, exclusive: (work) => work(), persist: async () => {} }),
  }));
  return run;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  hidden = false;
});

describe("usePendingRecoveryWake", () => {
  it("retries a pending capture when it comes due, without a reload", async () => {
    vi.useFakeTimers({ now: 0 });
    const run = mount(30_000);
    await act(async () => { await vi.advanceTimersByTimeAsync(29_000); });
    expect(run).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1_500); });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("waits while the app is hidden and retries on coming back", async () => {
    vi.useFakeTimers({ now: 0 });
    const run = mount(30_000);
    await act(async () => {
      hidden = true;
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(run).not.toHaveBeenCalled();
    await act(async () => {
      hidden = false;
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("never starts a second sort while the first is still running", async () => {
    vi.useFakeTimers({ now: 0 });
    let running = true;
    const run = mount(30_000, () => running);
    await act(async () => { await vi.advanceTimersByTimeAsync(50_000); });
    expect(run).not.toHaveBeenCalled();
    running = false;
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(run).toHaveBeenCalledTimes(1);
  });
});
