type Attempt = {
  controller: AbortController;
  timer: ReturnType<typeof setTimeout>;
  owner: symbol;
};

export function finalizingPendingTargetIds(
  ledger: { id: string; kind: string; targetId: string; captureId?: string; undone?: boolean }[],
  captureIds: string[],
): string[] {
  const captures = new Set(captureIds);
  return ledger.filter((entry) => entry.kind === "pending" && !entry.undone &&
    captures.has(entry.captureId ?? entry.id)).map((entry) => entry.targetId);
}

export type PlannedSortClaim = symbol;

export type PlannedSortFinalization = {
  /** True while this token exclusively owns the capture's commit phase. */
  current: () => boolean;
  /** Complete the phase. A failed write releases the capture for another try. */
  finish: (committed: boolean) => void;
};

/**
 * Owns the per-capture authority state for delayed automatic sorting.
 *
 * Manual work may revoke an automatic attempt only while it is still doing
 * provider/preparation work. Automatic persistence must first claim a short,
 * non-revocable finalization phase; from that point manual controls are locked
 * and a timeout cannot turn a physically committed write into a reported
 * failure.
 */
export class PlannedSortAuthority {
  private attempts = new Map<string, Attempt>();
  private claims = new Map<string, PlannedSortClaim>();
  private finalizations = new Map<string, symbol>();

  constructor(private readonly phaseChanged?: (captureIds: string[]) => void) {}

  private publishPhase() {
    this.phaseChanged?.([...this.finalizations.keys()]);
  }

  /** A sort for this capture is still running or committing. */
  busy(captureId: string): boolean {
    return this.attempts.has(captureId) || this.finalizations.has(captureId);
  }

  begin(captureId: string, timeoutMs: number) {
    if (this.finalizations.has(captureId)) {
      const controller = new AbortController();
      controller.abort();
      return {
        signal: controller.signal,
        owner: Symbol(captureId),
        run: <T>(work: Promise<T>): Promise<T> => {
          void work.catch(() => undefined);
          return Promise.reject(new DOMException(
            "Sort finalization already owns this capture",
            "AbortError",
          ));
        },
        authoritative: () => false,
        claimFinalization: () => null,
        finish: () => undefined,
      };
    }
    const previous = this.attempts.get(captureId);
    if (previous && !this.finalizations.has(captureId)) previous.controller.abort();
    const controller = new AbortController();
    const owner = Symbol(captureId);
    const attempt: Attempt = {
      controller,
      owner,
      timer: setTimeout(() => {
        if (!this.finalizations.has(captureId)) controller.abort();
      }, timeoutMs),
    };
    this.attempts.set(captureId, attempt);

    const claimFinalization = (): PlannedSortFinalization | null => {
      if (
        this.attempts.get(captureId) !== attempt ||
        this.claims.has(captureId) ||
        this.finalizations.has(captureId) ||
        controller.signal.aborted
      ) return null;
      clearTimeout(attempt.timer);
      const token = Symbol(captureId);
      this.finalizations.set(captureId, token);
      this.publishPhase();
      let finished = false;
      return {
        current: () =>
          !finished &&
          this.attempts.get(captureId) === attempt &&
          this.finalizations.get(captureId) === token,
        finish: () => {
          if (finished) return;
          finished = true;
          if (this.finalizations.get(captureId) === token) {
            this.finalizations.delete(captureId);
            this.publishPhase();
          }
          if (this.attempts.get(captureId) === attempt) this.attempts.delete(captureId);
        },
      };
    };

    return {
      signal: controller.signal,
      owner,
      run: <T>(work: Promise<T>): Promise<T> => Promise.race([
        work,
        new Promise<never>((_resolve, reject) => {
          const expired = () => reject(
            new DOMException("Sort deadline or authority expired", "AbortError"),
          );
          if (controller.signal.aborted) expired();
          else controller.signal.addEventListener("abort", expired, { once: true });
        }),
      ]),
      authoritative: () =>
        this.attempts.get(captureId)?.owner === owner &&
        !this.claims.has(captureId) &&
        !controller.signal.aborted,
      claimFinalization,
      finish: () => {
        clearTimeout(attempt.timer);
        if (this.finalizations.has(captureId)) return;
        if (this.attempts.get(captureId) !== attempt) return;
        this.attempts.delete(captureId);
      },
    };
  }

  claim(captureId: string): PlannedSortClaim | null {
    if (this.claims.has(captureId) || this.finalizations.has(captureId)) return null;
    const owner = Symbol(captureId);
    this.claims.set(captureId, owner);
    this.attempts.get(captureId)?.controller.abort();
    return owner;
  }

  claimed(captureId: string) {
    return this.claims.has(captureId);
  }

  finalizing(captureId: string) {
    return this.finalizations.has(captureId);
  }

  cancel(captureId: string) {
    if (this.finalizations.has(captureId)) return false;
    const attempt = this.attempts.get(captureId);
    attempt?.controller.abort();
    return !!attempt;
  }

  release(captureId: string, owner: PlannedSortClaim): boolean {
    if (this.claims.get(captureId) !== owner) return false;
    this.claims.delete(captureId);
    return true;
  }
}
