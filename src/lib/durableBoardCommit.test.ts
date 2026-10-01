// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import * as storage from "./storage";
import { EMPTY } from "./model";
import {
  DurableBoardCommitQueue,
  rebaseBoardMutation,
  runDurableBoardMutation,
} from "./durableBoardCommit";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

describe("durable board commit queue", () => {
  it("preserves routing authority and retirement metadata while rebasing a prepared mutation", () => {
    const proposed = {
      ...EMPTY,
      actions: [{
        id: "manual-artifact",
        text: "Manual artifact",
        done: false,
        at: 1,
        shelf: "keep" as const,
        expires: null,
      }],
      routingSettlements: [{
        id: "manual-authority",
        captureId: "capture",
        pendingId: "pending",
        revision: 1,
        settledBy: "manual" as const,
        artifacts: [{ kind: "action" as const, id: "manual-artifact" }],
      }],
      routingRetirements: [{
        captureId: "capture",
        pendingId: "pending",
        revision: 1,
        retiredAt: 10,
      }],
    };

    expect(rebaseBoardMutation(EMPTY, proposed, EMPTY)).toMatchObject({
      routingSettlements: proposed.routingSettlements,
      routingRetirements: proposed.routingRetirements,
    });
  });

  it("persists an adopted hub board exactly, without stamping its items as local edits", async () => {
    const note = (updatedAt: number) => ({ id: "n1", at: 1, text: "Rain tower", updatedAt });
    const local = { ...EMPTY, threads: [{ id: "t1", name: "Ovid", summary: "", updatedAt: 1, frags: [note(1)] }] };
    const fromHub = { ...EMPTY, threads: [{ id: "t1", name: "Ovid", summary: "", updatedAt: 5, frags: [note(5)] }] };
    const run = (asIs: boolean) => runDurableBoardMutation({
      queue: new DurableBoardCommitQueue(), allowed: () => true,
      read: () => ({ board: local, tombstones: [] }),
      build: () => ({ next: fromHub, value: null, asIs }),
      adopt: () => {}, committed: () => {},
    });
    const adopted = await run(true);
    if (adopted.status !== "committed") throw new Error(adopted.status);
    expect(adopted.board.threads[0].frags[0].updatedAt).toBe(5);
    expect(adopted.board.threads[0].updatedAt).toBe(5);
    const edited = await run(false);
    if (edited.status !== "committed") throw new Error(edited.status);
    expect(edited.board.threads[0].frags[0].updatedAt).toBeGreaterThan(5);
  });

  it("serializes transactions and lets each transaction prepare from the state committed before it", async () => {
    const queue = new DurableBoardCommitQueue();
    const firstWrite = deferred<void>();
    let current = ["pending"];
    const started: string[] = [];

    const first = queue.run(async () => {
      started.push("manual");
      const next = [...current, "manual-settlement"];
      await firstWrite.promise;
      current = next;
      return true;
    });
    const second = queue.run(async () => {
      started.push("new-intake");
      current = [...current, "new-capture"];
      return true;
    });

    await Promise.resolve();
    expect(started).toEqual(["manual"]);
    firstWrite.resolve();
    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
    expect(started).toEqual(["manual", "new-intake"]);
    expect(current).toEqual(["pending", "manual-settlement", "new-capture"]);
  });

  it("continues after a failed transaction instead of leaving later durable work blocked", async () => {
    const queue = new DurableBoardCommitQueue();
    const first = queue.run(async () => { throw new Error("disk failed"); });
    const second = queue.run(async () => "saved");

    await expect(first).rejects.toThrow("disk failed");
    await expect(second).resolves.toBe("saved");
  });

  it("revalidates a guarded mutation when its turn reaches the durable write seam", async () => {
    const queue = new DurableBoardCommitQueue();
    const blocker = deferred<void>();
    const first = queue.run(async () => blocker.promise);
    let authoritative = true;
    const writes = vi.spyOn(storage, "setMany");
    const adopted = vi.fn();
    const mutation = runDurableBoardMutation({
      queue,
      allowed: () => true,
      guard: () => authoritative,
      read: () => ({ board: EMPTY, tombstones: [] }),
      build: (current) => ({ next: { ...current, historyEpoch: 1 }, value: true }),
      adopt: adopted,
      committed: vi.fn(),
    });

    authoritative = false;
    blocker.resolve();
    await first;

    await expect(mutation).resolves.toEqual({ status: "failed" });
    expect(writes).not.toHaveBeenCalled();
    expect(adopted).not.toHaveBeenCalled();
  });

  it("truthfully adopts a write that persistence already committed instead of pretending it was canceled", async () => {
    const queue = new DurableBoardCommitQueue();
    const persisted = deferred<void>();
    vi.spyOn(storage, "setMany").mockImplementationOnce(async () => persisted.promise);
    let authoritative = true;
    const adopted = vi.fn();
    const committed = vi.fn();
    const mutation = runDurableBoardMutation({
      queue,
      allowed: () => true,
      guard: () => authoritative,
      read: () => ({ board: EMPTY, tombstones: [] }),
      build: (current) => ({ next: { ...current, historyEpoch: 1 }, value: true }),
      adopt: adopted,
      committed,
    });
    await Promise.resolve();
    authoritative = false;
    persisted.resolve();

    await expect(mutation).resolves.toMatchObject({
      status: "committed",
      board: expect.objectContaining({ historyEpoch: 1 }),
    });
    expect(adopted).toHaveBeenCalledTimes(1);
    expect(committed).toHaveBeenCalledTimes(1);
  });
});
