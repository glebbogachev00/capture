import type { Board } from "./model";
import {
  PENDING_RECOVERY_KEY,
  claimPendingRecovery,
  createPendingRecoveryRecord,
  parsePendingRecoveryRecords,
  prunePendingRecoveryRecords,
  recoveryCandidates,
  serializePendingRecoveryRecords,
  type PendingRecoveryRecord,
  type PendingRecoverySnapshot,
} from "./pendingRecovery";

export type PendingRecoveryStore = {
  key: typeof PENDING_RECOVERY_KEY;
  records: PendingRecoveryRecord[];
  serialized: string;
};

type Exclusive = <T>(work: () => Promise<T>) => Promise<T>;
export type PendingRecoveryAccess = {
  board: () => Board;
  allowed: () => boolean;
  exclusive: Exclusive;
  persist: (key: string, value: string) => Promise<void>;
};

/** Device-local, edge-triggered pending recovery. The caller supplies the
 * existing durable lane and provider runner; this class owns only bounded
 * record lifecycle and never installs timers or polling. */
export class PendingRecoveryOrchestrator {
  private records: PendingRecoveryRecord[] = [];
  private wakeActive = false;

  load(raw: string | null, board: Board): void {
    /* Keep parsed disk state until retirement itself commits. Pruning only in
       memory here made the following durable prune compare [] with [] and
       leave stale bytes on disk forever. `board` remains part of this seam so
       callers cannot accidentally load before the authoritative Board. */
    void board;
    this.records = parsePendingRecoveryRecords(raw);
  }

  nextForIntake(
    current: Board,
    snapshot: PendingRecoverySnapshot,
    automaticAttempts: number,
    nextAttemptAt: number,
  ): PendingRecoveryStore {
    const record = createPendingRecoveryRecord(snapshot, automaticAttempts, nextAttemptAt);
    const records = [
      record,
      ...prunePendingRecoveryRecords(this.records, current)
        .filter((candidate) => candidate.id !== record.id),
    ];
    return {
      key: PENDING_RECOVERY_KEY,
      records,
      serialized: serializePendingRecoveryRecords(records),
    };
  }

  adopt(records: PendingRecoveryRecord[]): void {
    this.records = records;
  }

  async prune(options: PendingRecoveryAccess): Promise<void> {
    await options.exclusive(async () => {
      if (!options.allowed()) return;
      const next = prunePendingRecoveryRecords(this.records, options.board());
      const serialized = serializePendingRecoveryRecords(next);
      if (serialized === serializePendingRecoveryRecords(this.records)) return;
      await options.persist(PENDING_RECOVERY_KEY, serialized);
      this.records = next;
    });
  }

  async wake(options: PendingRecoveryAccess & {
    now: () => number;
    online: () => boolean;
    run: (snapshot: PendingRecoverySnapshot) => Promise<void>;
  }): Promise<void> {
    if (this.wakeActive || !options.allowed() || !options.online()) return;
    this.wakeActive = true;
    try {
      /* Also retry a failed startup retirement on the next explicit wake.
         prune adopts only after persistence, so failure remains truthful. */
      await this.prune(options);
      const due = recoveryCandidates(this.records, options.board(), options.now());
      for (const candidate of due) {
        const snapshot = await options.exclusive(async () => {
          if (!options.allowed()) return null;
          const current = prunePendingRecoveryRecords(this.records, options.board());
          const claimed = claimPendingRecovery(
            current,
            options.board(),
            candidate.id,
            options.now(),
          );
          const records = claimed?.records ?? current;
          const serialized = serializePendingRecoveryRecords(records);
          if (serialized !== serializePendingRecoveryRecords(this.records)) {
            await options.persist(PENDING_RECOVERY_KEY, serialized);
            this.records = records;
          }
          return claimed?.snapshot ?? null;
        });
        if (!snapshot) continue;
        await options.run(snapshot);
        await this.prune(options);
      }
    } finally {
      this.wakeActive = false;
    }
  }
}
