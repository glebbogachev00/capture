import type { CaptureEntry } from "./ledger";
import type { Action, Board, Frag, Intention, Thread } from "./model";
import type {
  ManualPendingSnapshot,
  ManualRoutingResult,
} from "./manualRoutingSettlement";
import { mergeTombstones, type Tombstone } from "./sync";

export const MANUAL_ROUTING_UNDO_KEY = "capture:manual-routing-undo:v1";

type ArtifactSnapshot =
  | { kind: "action"; value: Action }
  | { kind: "thread"; value: Thread }
  | { kind: "frag"; threadId: string; value: Frag }
  | { kind: "intention"; value: Intention };

export type ManualRoutingUndo = {
  version: 1;
  captureId: string;
  pendingAction: Action;
  pendingEntry: CaptureEntry;
  settlementEntry: CaptureEntry;
  artifacts: ArtifactSnapshot[];
  ownedTombstones: Tombstone[];
  destinationLabel: string;
};

export type ManualRoutingUndoResult =
  | { status: "applied"; board: Board; tombstones: Tombstone[] }
  | { status: "conflict"; reason: "missing" | "changed" | "already_undone" };

function artifactSnapshots(
  board: Board,
  artifacts: NonNullable<CaptureEntry["settlementArtifacts"]>,
): ArtifactSnapshot[] {
  return artifacts.flatMap((artifact): ArtifactSnapshot[] => {
    if (artifact.kind === "action") {
      const value = board.actions.find((item) => item.id === artifact.id);
      return value ? [{ kind: "action", value }] : [];
    }
    if (artifact.kind === "thread") {
      const value = board.threads.find((item) => item.id === artifact.id);
      return value ? [{ kind: "thread", value }] : [];
    }
    if (artifact.kind === "intention") {
      const value = board.intentions.find((item) => item.id === artifact.id);
      return value ? [{ kind: "intention", value }] : [];
    }
    for (const thread of board.threads) {
      const value = thread.frags.find((item) => item.id === artifact.id);
      if (value) return [{ kind: "frag", threadId: thread.id, value }];
    }
    return [];
  });
}

export function buildManualRoutingUndo(
  before: Board,
  beforeTombstones: Tombstone[],
  snapshot: ManualPendingSnapshot,
  settled: Extract<ManualRoutingResult, { status: "applied" }>,
  destinationLabel: string,
): ManualRoutingUndo {
  const pendingAction = before.actions.find((action) => action.id === snapshot.targetId);
  const pendingEntry = before.ledger.find((entry) => entry.id === snapshot.pendingId);
  const settlementEntry = settled.board.ledger.find((entry) => entry.id === settled.ledgerId);
  if (!pendingAction || !pendingEntry || !settlementEntry?.settlementArtifacts) {
    throw new Error("manual undo identity is incomplete");
  }
  const beforeTombstoneKeys = new Set(beforeTombstones.map((item) =>
    `${item.kind}:${item.id}:${item.deletedAt}`
  ));
  return {
    version: 1,
    captureId: snapshot.captureId,
    pendingAction: structuredClone(pendingAction),
    pendingEntry: structuredClone(pendingEntry),
    settlementEntry: structuredClone(settlementEntry),
    artifacts: artifactSnapshots(settled.board, settlementEntry.settlementArtifacts)
      .map((artifact) => structuredClone(artifact)),
    ownedTombstones: settled.tombstones.filter((item) =>
      !beforeTombstoneKeys.has(`${item.kind}:${item.id}:${item.deletedAt}`)
    ),
    destinationLabel,
  };
}

const stable = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key, nested]) => key !== "updatedAt" && nested !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => [key, stable(nested)]));
};
const same = (left: unknown, right: unknown) =>
  JSON.stringify(stable(left)) === JSON.stringify(stable(right));

function liveArtifact(board: Board, snapshot: ArtifactSnapshot): unknown {
  if (snapshot.kind === "action") return board.actions.find((item) => item.id === snapshot.value.id);
  if (snapshot.kind === "thread") return board.threads.find((item) => item.id === snapshot.value.id);
  if (snapshot.kind === "intention") return board.intentions.find((item) => item.id === snapshot.value.id);
  const home = board.threads.find((thread) => thread.frags.some((frag) => frag.id === snapshot.value.id));
  const value = home?.frags.find((frag) => frag.id === snapshot.value.id);
  return value && home?.id === snapshot.threadId ? value : undefined;
}

export function undoManualRouting(
  board: Board,
  tombstones: Tombstone[],
  record: ManualRoutingUndo,
  now: number,
): ManualRoutingUndoResult {
  const settlement = board.ledger.find((entry) => entry.id === record.settlementEntry.id);
  if (settlement?.undone) return { status: "conflict", reason: "already_undone" };
  if (!settlement) return { status: "conflict", reason: "missing" };
  if (!same(settlement, record.settlementEntry)) return { status: "conflict", reason: "changed" };
  const retired = board.ledger.find((entry) => entry.id === record.pendingEntry.id);
  if (!same(retired, { ...record.pendingEntry, undone: true, imgs: undefined })) {
    return { status: "conflict", reason: "changed" };
  }
  if (!record.artifacts.length || record.artifacts.length !== settlement.settlementArtifacts?.length) {
    return { status: "conflict", reason: "missing" };
  }
  const owned = new Map(record.ownedTombstones.map((item) => [
    `${item.kind}:${item.id}`, item.deletedAt,
  ]));
  if (tombstones.some((item) =>
    (owned.has(`${item.kind}:${item.id}`) && owned.get(`${item.kind}:${item.id}`) !== item.deletedAt) ||
    record.artifacts.some((artifact) => artifact.kind === item.kind && artifact.value.id === item.id)
  )) return { status: "conflict", reason: "changed" };
  for (const artifact of record.artifacts) {
    const live = liveArtifact(board, artifact);
    if (!live) return { status: "conflict", reason: "missing" };
    if (!same(live, artifact.value)) return { status: "conflict", reason: "changed" };
  }
  if (board.actions.some((action) => action.id === record.pendingAction.id)) {
    return { status: "conflict", reason: "changed" };
  }

  const artifactIds = new Set(record.artifacts.map((artifact) => artifact.value.id));
  const restoredAction = { ...record.pendingAction, updatedAt: now };
  // Retirement is monotonic in sync. Append the inverse's new pending slot,
  // preserving capture/action identity and all source evidence, rather than
  // reopening the retired row (which an older remote ledger would close again).
  const restoredPending = { ...record.pendingEntry,
    id: `undo:${record.settlementEntry.id}`, captureId: record.captureId, undone: false };
  if (board.ledger.some((entry) => entry.id === restoredPending.id)) {
    return { status: "conflict", reason: "already_undone" };
  }
  const next: Board = {
    ...board,
    actions: [
      ...board.actions.filter((action) => !artifactIds.has(action.id)),
      restoredAction,
    ],
    threads: board.threads
      .filter((thread) => !artifactIds.has(thread.id))
      .map((thread) => ({
        ...thread,
        frags: thread.frags.filter((frag) => !artifactIds.has(frag.id)),
      })),
    intentions: board.intentions.filter((intention) => !artifactIds.has(intention.id)),
    ledger: [restoredPending, ...board.ledger.map((entry) => {
      if (entry.id === record.settlementEntry.id) return { ...entry, undone: true };
      return entry;
    })],
  };
  const preserved = tombstones.filter((item) =>
    owned.get(`${item.kind}:${item.id}`) !== item.deletedAt
  );
  const generated = record.artifacts.flatMap((artifact): Tombstone[] => {
    if (artifact.kind === "frag") return [{ kind: "frag", id: artifact.value.id, deletedAt: now }];
    return [{ kind: artifact.kind, id: artifact.value.id, deletedAt: now }];
  });
  return { status: "applied", board: next, tombstones: mergeTombstones(preserved, generated, now) };
}

export function parseManualRoutingUndo(raw: string | null): ManualRoutingUndo | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as ManualRoutingUndo;
    return value?.version === 1 && typeof value.captureId === "string" &&
      !!value.pendingAction && !!value.pendingEntry && !!value.settlementEntry &&
      Array.isArray(value.artifacts) && Array.isArray(value.ownedTombstones) &&
      typeof value.destinationLabel === "string"
      ? value
      : null;
  } catch {
    return null;
  }
}
