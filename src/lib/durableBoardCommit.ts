import {
  applyTombstones,
  mergeTombstones,
  stampChanges,
  TOMBSTONE_KEY,
  type SyncState,
  type Tombstone,
} from "./sync";
import { KEY, type Board } from "./model";
import { setMany } from "./storage";

export type DurableMutation<T> =
  | {
      next: Board;
      value: T;
      tombstones?: Tombstone[];
      replaceTombstones?: Tombstone[];
      /** Inverse receipts must snapshot the exact stamped state written below. */
      entries?: [string, string][] | ((prepared: SyncState) => [string, string][]);
      /** The hub's merged answer: persist it exactly. Stamping it would mark
          every item another device changed as edited here, just now, and the
          two devices would re-send the whole board to each other forever. */
      asIs?: boolean;
    }
  | { skip: T };
export type DurableMutationResult<T> =
  | { status: "committed"; value: T; board: Board; tombstones: Tombstone[] }
  | { status: "skipped"; value: T }
  | { status: "failed" };

export type DurableFinalizationClaim = {
  current: () => boolean;
  finish: (committed: boolean) => void;
};

/** One document owns the Board, so every local persistence transaction uses
 * one lane. Work starts only after the preceding write has either committed
 * or failed; preparing inside `run` therefore always sees the latest durable
 * state instead of a snapshot captured before an older write finished. */
export class DurableBoardCommitQueue {
  private tail: Promise<void> = Promise.resolve();
  private pending = 0;

  run<T>(transaction: () => Promise<T>): Promise<T> {
    let result: Promise<T>;
    try {
      result = this.pending === 0
        ? transaction()
        : this.tail.then(transaction, transaction);
    } catch (error) {
      result = Promise.reject(error);
    }
    this.pending += 1;
    this.tail = result.then(
      () => { this.pending -= 1; },
      () => { this.pending -= 1; },
    );
    return result;
  }
}

const same = (left: unknown, right: unknown) =>
  left === right || JSON.stringify(left) === JSON.stringify(right);

function rebaseEntities<T extends { id: string }>(
  base: T[],
  proposed: T[],
  current: T[],
): T[] | null {
  const baseById = new Map(base.map((item) => [item.id, item]));
  const proposedById = new Map(proposed.map((item) => [item.id, item]));
  const currentById = new Map(current.map((item) => [item.id, item]));
  const touched = new Set([...baseById.keys(), ...proposedById.keys()].filter((id) =>
    !same(baseById.get(id), proposedById.get(id))
  ));
  for (const id of touched) {
    const before = baseById.get(id);
    const live = currentById.get(id);
    const wanted = proposedById.get(id);
    if (!same(live, before) && !same(live, wanted)) return null;
  }

  const rebased = current.flatMap((item) => {
    if (!touched.has(item.id)) return [item];
    const replacement = proposedById.get(item.id);
    return replacement ? [replacement] : [];
  });
  for (const addition of proposed.filter((item) => !baseById.has(item.id))) {
    if (rebased.some((item) => item.id === addition.id)) continue;
    const proposedIndex = proposed.findIndex((item) => item.id === addition.id);
    if (proposedIndex === 0) rebased.unshift(addition);
    else rebased.push(addition);
  }
  return rebased;
}

/** Rebase a Board value prepared before an older durable transaction finished.
 * Entity changes commute only when they touch different ids. Conflicting edits
 * to the same entity fail instead of being acknowledged or silently won. */
export function rebaseBoardMutation(
  base: Board,
  proposed: Board,
  current: Board,
): Board | null {
  const actions = rebaseEntities(base.actions, proposed.actions, current.actions);
  const threads = rebaseEntities(base.threads, proposed.threads, current.threads);
  const intentions = rebaseEntities(base.intentions, proposed.intentions, current.intentions);
  const principles = rebaseEntities(base.principles, proposed.principles, current.principles);
  if (!actions || !threads || !intentions || !principles) return null;

  const scalar = <K extends
    | "historyEpoch"
    | "historyImports"
    | "profile"
    | "routingSettlements"
    | "routingRetirements"
  >(
    key: K,
  ): Board[K] | null => {
    if (same(base[key], proposed[key])) return current[key];
    if (same(current[key], base[key]) || same(current[key], proposed[key])) return proposed[key];
    return null;
  };
  const historyEpoch = scalar("historyEpoch");
  const historyImports = scalar("historyImports");
  const profile = scalar("profile");
  const routingSettlements = scalar("routingSettlements");
  const routingRetirements = scalar("routingRetirements");
  if (
    historyEpoch === null || historyImports === null || profile === null ||
    routingSettlements === null || routingRetirements === null
  ) return null;

  return {
    ...current,
    actions,
    threads,
    intentions,
    principles,
    ledger: proposed.ledger,
    corrections: proposed.corrections,
    wraps: proposed.wraps,
    completions: proposed.completions,
    routingSettlements,
    routingRetirements,
    historyEpoch,
    historyImports,
    profile,
  };
}

/** Persist and adopt one freshly prepared Board transition inside the shared
 * document lane. `build` runs only when its turn arrives, against the state
 * committed by every earlier transaction. */
export function runDurableBoardMutation<T>(options: {
  queue: DurableBoardCommitQueue;
  allowed: () => boolean;
  /** Revalidated inside the durable lane, at IDB execution, and again before
   * adoption. Use for operation authority that can be revoked while queued. */
  guard?: () => boolean;
  signal?: AbortSignal;
  /** Acquired inside the durable lane immediately before persistence. Once
   * acquired, operation-level revocation is closed and manual work must fail
   * its competing claim instead of pretending a committed write was canceled. */
  finalize?: () => DurableFinalizationClaim | null;
  read: () => SyncState;
  build: (current: Board, tombstones: Tombstone[]) => DurableMutation<T>;
  adopt: (state: SyncState) => void;
  committed: () => void;
}): Promise<DurableMutationResult<T>> {
  return options.queue.run(async () => {
    const currentAuthority = () =>
      options.allowed() &&
      !options.signal?.aborted &&
      (options.guard?.() ?? true);
    if (!currentAuthority()) return { status: "failed" };
    const current = options.read();
    const mutation = options.build(current.board, current.tombstones);
    if ("skip" in mutation) return { status: "skipped", value: mutation.skip };
    const prepared = mutation.asIs
      ? { board: mutation.next, tombstones: mutation.replaceTombstones ?? current.tombstones }
      : prepareDurableBoardCommit(
          current.board,
          mutation.next,
          mutation.replaceTombstones ?? current.tombstones,
          mutation.tombstones ?? [],
        );
    const finalization = options.finalize?.();
    if (options.finalize && !finalization) return { status: "failed" };
    try {
      if (!finalization && !currentAuthority()) return { status: "failed" };
      await setMany([
        [KEY, JSON.stringify(prepared.board)],
        [TOMBSTONE_KEY, JSON.stringify(prepared.tombstones)],
        ...(typeof mutation.entries === "function" ? mutation.entries(prepared) : mutation.entries ?? []),
      ], finalization
        ? { current: () => options.allowed() && finalization.current() }
        : { signal: options.signal, current: currentAuthority });
    } catch {
      finalization?.finish(false);
      return { status: "failed" };
    }
    /* IDB completion is the commit fact. Never re-read revocable operation
       authority after it: a successful write must be adopted and reported as
       committed, or disk and React can disagree until reload. */
    finalization?.finish(true);
    options.adopt(prepared);
    options.committed();
    return { status: "committed", value: mutation.value, ...prepared };
  });
}

/** Build the exact local transaction for intake or delayed settlement. The
 * caller persists this state before adopting it in React. */
export function prepareDurableBoardCommit(
  current: Board,
  next: Board,
  currentTombstones: Tombstone[],
  explicitTombstones: Tombstone[] = [],
  now = Date.now(),
): SyncState {
  const supplied = explicitTombstones.length
    ? mergeTombstones(currentTombstones, explicitTombstones, now)
    : currentTombstones;
  const stamped = stampChanges(current, applyTombstones(next, supplied), now);
  const tombstones = stamped.tombstones.length
    ? mergeTombstones(supplied, stamped.tombstones, now)
    : supplied;
  return { board: stamped.board, tombstones };
}
