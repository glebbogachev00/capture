export type BackupOperationKind = "export" | "restore";
export type BackupOperationToken = {
  kind: BackupOperationKind;
  generation: number;
};
export type BackupMutationToken = { id: number };

/** One synchronous document-local gate for backup work and restore exclusivity.
 * React state is presentation only; it cannot arbitrate two calls made before
 * the next render. Generation checks let older sync replies retire harmlessly. */
export function createBackupMutationGuard(
  gate: BackupOperationGate,
  onRefused: () => void,
) {
  return <Args extends unknown[], Result>(mutation: (...args: Args) => Result) =>
    (...args: Args): Result => gate.runMutation(
      () => mutation(...args),
      () => { onRefused(); return false as unknown as Result; },
    );
}

export class BackupOperationGate {
  private active: BackupOperationToken | null = null;
  private pendingRestore: {
    token: BackupOperationToken;
    resolve: (token: BackupOperationToken) => void;
  } | null = null;
  private value = 0;
  private mutationValue = 0;
  private mutations = new Set<number>();

  get generation(): number { return this.value; }
  get restoreActive(): boolean {
    return this.active?.kind === "restore" || this.pendingRestore !== null;
  }

  start(kind: BackupOperationKind): BackupOperationToken | null {
    if (this.active || this.pendingRestore || this.mutations.size) return null;
    const token = { kind, generation: ++this.value };
    this.active = token;
    return token;
  }

  /** Reserve restore synchronously, then wait for every mutation lease that
   * already owns the document. New mutations are refused from this point on,
   * while the existing callbacks may finish their durable work. */
  startRestore(): BackupOperationToken | Promise<BackupOperationToken> | null {
    if (this.active || this.pendingRestore) return null;
    const token: BackupOperationToken = { kind: "restore", generation: ++this.value };
    if (!this.mutations.size) {
      this.active = token;
      return token;
    }
    return new Promise((resolve) => {
      this.pendingRestore = { token, resolve };
    });
  }

  finish(token: BackupOperationToken): void {
    if (this.active?.kind !== token.kind || this.active.generation !== token.generation) return;
    this.active = null;
    this.value++;
  }

  isCurrent(generation: number): boolean {
    return generation === this.value && !this.restoreActive;
  }

  startMutation(): BackupMutationToken | null {
    if (this.restoreActive) return null;
    const token = { id: ++this.mutationValue };
    this.mutations.add(token.id);
    return token;
  }

  finishMutation(token: BackupMutationToken): void {
    this.mutations.delete(token.id);
    if (this.mutations.size || !this.pendingRestore) return;
    const pending = this.pendingRestore;
    this.pendingRestore = null;
    this.active = pending.token;
    pending.resolve(pending.token);
  }

  /** Attach work spawned by a guarded mutation to its own lease. The caller
   * may stay fire-and-forget for responsive UI, but restore remains queued
   * until the related promise settles. */
  trackMutation<Result>(operation: Promise<Result>): Promise<Result> {
    const token = { id: ++this.mutationValue };
    this.mutations.add(token.id);
    return operation.finally(() => this.finishMutation(token));
  }

  runMutation<Result>(operation: () => Result, onRefused: () => Result): Result {
    const token = this.startMutation();
    if (!token) return onRefused();
    try {
      const result = operation();
      const pending = result as unknown as Promise<unknown>;
      if (result && typeof pending.finally === "function") {
        return pending.finally(() => this.finishMutation(token)) as Result;
      }
      this.finishMutation(token);
      return result;
    } catch (error) {
      this.finishMutation(token);
      throw error;
    }
  }

  leaveRestore(onRefused: () => void, onAllowed: () => void): boolean {
    if (this.restoreActive) { onRefused(); return false; }
    onAllowed();
    return true;
  }

  allowMutation(token?: BackupOperationToken): boolean {
    if (this.active?.kind !== "restore") return true;
    return !!token && this.active.generation === token.generation;
  }
}
