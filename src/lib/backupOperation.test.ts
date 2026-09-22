import { describe, expect, it } from "vitest";
import { BackupOperationGate } from "./backupOperation";

describe("BackupOperationGate", () => {
  it("rejects same-turn duplicate export and restore starts synchronously", () => {
    const gate = new BackupOperationGate();
    const exportToken = gate.start("export");
    expect(exportToken).not.toBeNull();
    expect(gate.start("export")).toBeNull();
    expect(gate.start("restore")).toBeNull();
  });

  it("holds restore behind an active mutation and refuses every mutation once restore owns the gate", () => {
    const gate = new BackupOperationGate();
    const mutation = gate.startMutation()!;
    expect(gate.start("restore")).toBeNull();
    gate.finishMutation(mutation);
    const restore = gate.start("restore")!;
    expect(gate.startMutation()).toBeNull();
    gate.finish(restore);
    expect(gate.startMutation()).not.toBeNull();
  });

  it("queues restore behind related work registered before the mutation callback returns", async () => {
    const gate = new BackupOperationGate();
    let finishDeletion!: () => void;
    const deletion = new Promise<void>((resolve) => { finishDeletion = resolve; });
    const mutation = gate.runMutation(async () => {
      gate.trackMutation(deletion);
    }, () => Promise.resolve());
    await mutation;

    const waiting = gate.startRestore();
    expect(waiting).not.toBeNull();
    expect(gate.restoreActive).toBe(true);
    expect(gate.startMutation()).toBeNull();
    let restoreStarted = false;
    void Promise.resolve(waiting!).then(() => { restoreStarted = true; });
    await Promise.resolve();
    expect(restoreStarted).toBe(false);

    finishDeletion();
    const restore = await waiting!;
    expect(restoreStarted).toBe(true);
    gate.finish(restore);
    expect(gate.restoreActive).toBe(false);
  });

  it("makes restore exclusive, invalidates earlier sync generations, and releases only its own token", () => {
    const gate = new BackupOperationGate();
    const before = gate.generation;
    const restore = gate.start("restore")!;
    expect(gate.restoreActive).toBe(true);
    expect(gate.isCurrent(before)).toBe(false);
    expect(gate.allowMutation()).toBe(false);
    gate.finish({ kind: "restore", generation: restore.generation + 1 });
    expect(gate.restoreActive).toBe(true);
    gate.finish(restore);
    expect(gate.restoreActive).toBe(false);
    expect(gate.allowMutation()).toBe(true);
  });
});
