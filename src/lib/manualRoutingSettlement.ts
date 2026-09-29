import { appendLedger, type CaptureEntry, type CaptureSource } from "./ledger";
import {
  nextNumber,
  type Action,
  type Board,
  type Frag,
  type Intention,
  type Thread,
} from "./model";
import type { Tombstone } from "./sync";

export type ManualDestination =
  | { kind: "action" }
  | { kind: "intention" }
  | { kind: "thread"; threadId: string | null; threadName?: string };

/** Immutable view of the exact pending card selected by the person. */
export type ManualPendingSnapshot = Action & {
  pendingId: string;
  captureId: string;
  targetId: string;
  source: string;
  imageIds: string[];
  revision: number;
  inputSource: CaptureSource;
};

export type ManualRoutingConflictReason =
  | "already_settled"
  | "not_pending"
  | "pending_mismatch"
  | "stale_destination"
  | "identity_collision";

export type ManualRoutingTarget =
  | { kind: "action"; id: string }
  | { kind: "intention"; id: string }
  | { kind: "thread"; id: string; fragId: string; created: boolean };

export type ManualRoutingResult =
  | {
      status: "applied";
      board: Board;
      captureId: string;
      target: ManualRoutingTarget;
      ledgerId: string;
      tombstones: Tombstone[];
    }
  | {
      status: "conflict";
      board: Board;
      captureId: string;
      reason: ManualRoutingConflictReason;
    };

const enc = (value: string) => value.replace(/[^A-Za-z0-9.-]/g, (char) =>
  `~${char.charCodeAt(0).toString(16).padStart(4, "0")}~`
);

const captureIdentity = (entry: CaptureEntry) => entry.captureId ?? entry.id;
const sameIds = (left: string[] | undefined, right: string[]) =>
  (left ?? []).length === right.length &&
  (left ?? []).every((id, index) => id === right[index]);

export function snapshotManualPending(
  ledger: CaptureEntry[],
  shown: Action,
): ManualPendingSnapshot | null {
  const rows = ledger.filter((entry) =>
    entry.kind === "pending" && !entry.undone && entry.targetId === shown.id
  );
  if (rows.length !== 1) return null;
  const pending = rows[0];
  return {
    ...shown,
    pendingId: pending.id,
    captureId: captureIdentity(pending),
    targetId: shown.id,
    source: shown.src ?? shown.text,
    imageIds: [...(shown.imgs ?? [])],
    revision: shown.pendingRevision ?? 1,
    inputSource: pending.source,
  };
}

function conflict(
  board: Board,
  captureId: string,
  reason: ManualRoutingConflictReason,
): ManualRoutingResult {
  return { status: "conflict", board, captureId, reason };
}

/** A deliberately mechanical label for an offline-created Thread. The prefix
 * makes its provisional nature visible; no generated meaning or learned
 * routing boundary is attached to it. */
export function temporaryThreadTitle(source: string): string {
  const opening = source.trim().split(/\s+/).filter(Boolean).slice(0, 5).join(" ");
  return `Temporary — ${opening || "New thread"}`;
}

/** Resolve an on-screen pending envelope to its immutable identity before
 * applying the explicit destination. */
export function settleManualRoutingForAction(
  board: Board,
  shown: ManualPendingSnapshot,
  destination: ManualDestination,
  now: number,
): ManualRoutingResult {
  return settleManualRouting(board, {
    captureId: shown.captureId,
    pendingId: shown.pendingId,
    pendingTargetId: shown.targetId,
    pendingSource: shown.source,
    pendingImageIds: shown.imageIds,
    pendingInputSource: shown.inputSource,
    revision: shown.revision,
    destination,
    now,
  });
}

/** Apply one explicit destination choice to the exact pending envelope the
 * person saw. Persistence remains a caller responsibility so the board and
 * retirement tombstone can be written in one local transaction. */
export function settleManualRouting(
  board: Board,
  input: {
    captureId: string;
    pendingId?: string;
    pendingTargetId?: string;
    pendingSource?: string;
    pendingImageIds?: string[];
    pendingInputSource?: CaptureSource;
    revision: number;
    destination: ManualDestination;
    now: number;
  },
): ManualRoutingResult {
  const {
    captureId,
    pendingId,
    pendingTargetId,
    pendingSource: shownSource,
    pendingImageIds,
    pendingInputSource,
    revision,
    destination,
    now,
  } = input;
  const resolvedRows = board.ledger.filter((entry) =>
    captureIdentity(entry) === captureId && entry.kind !== "pending" && !entry.undone
  );
  const pendingRows = board.ledger.filter((entry) =>
    entry.kind === "pending" && !entry.undone && captureIdentity(entry) === captureId
  );
  const targetRows = pendingTargetId ? board.ledger.filter((entry) =>
    entry.kind === "pending" && !entry.undone && entry.targetId === pendingTargetId
  ) : [];
  if (pendingTargetId && targetRows.length !== 1) {
    return conflict(board, captureId, "pending_mismatch");
  }
  const pending = pendingId
    ? pendingRows.find((entry) => entry.id === pendingId)
    : pendingRows.length === 1
      ? pendingRows[0]
      : undefined;
  if (!pending) {
    return conflict(board, captureId, resolvedRows.length ? "already_settled" : "not_pending");
  }
  /* A planned partial settlement intentionally has resolved rows and one or
     more discontiguous pending rows under the same capture identity. The exact
     shown row may continue; an ordinary already-settled capture cannot. */
  if (resolvedRows.length && !pending.partial) {
    return conflict(board, captureId, "already_settled");
  }
  const envelope = board.actions.find((action) =>
    action.id === pending.targetId &&
    (!pendingTargetId || action.id === pendingTargetId) &&
    action.unsorted
  );
  if (!envelope) return conflict(board, captureId, "not_pending");

  const pendingRevision = pending.pendingRevision ?? 1;
  const envelopeRevision = envelope.pendingRevision ?? 1;
  const source = envelope.src ?? envelope.text;
  const sameImages = (envelope.imgs ?? []).length === (pending.imgs ?? []).length &&
    (envelope.imgs ?? []).every((id, index) => id === pending.imgs?.[index]);
  if (
    revision !== pendingRevision ||
    envelopeRevision !== pendingRevision ||
    (pendingTargetId !== undefined && pending.targetId !== pendingTargetId) ||
    (shownSource !== undefined && shownSource !== source) ||
    (pendingInputSource !== undefined && pending.source !== pendingInputSource) ||
    (pending.pendingSource ?? pending.clean) !== source ||
    !sameImages ||
    (pendingImageIds !== undefined && (
      !sameIds(pending.imgs, pendingImageIds) ||
      !sameIds(envelope.imgs, pendingImageIds)
    ))
  ) return conflict(board, captureId, "pending_mismatch");

  const selectedThread = destination.kind === "thread" && destination.threadId
    ? board.threads.find((thread) => thread.id === destination.threadId)
    : undefined;
  if (destination.kind === "thread" && destination.threadId && !selectedThread) {
    return conflict(board, captureId, "stale_destination");
  }

  const base = `manual:${enc(captureId)}:${enc(pending.id)}:r${pendingRevision}`;
  const ledgerId = `${base}:settlement`;
  const artifactId = destination.kind === "thread" && selectedThread
    ? `${base}:frag`
    : `${base}:${destination.kind}`;
  const occupied = new Set([
    ...board.actions.filter((action) => action.id !== envelope.id).map((action) => action.id),
    ...board.threads.map((thread) => thread.id),
    ...board.threads.flatMap((thread) => thread.frags.map((frag) => frag.id)),
    ...board.intentions.map((intention) => intention.id),
  ]);
  if (
    occupied.has(artifactId) ||
    board.ledger.some((entry) => entry.id === ledgerId && entry.id !== pending.id)
  ) return conflict(board, captureId, "identity_collision");

  let actions = board.actions.filter((candidate) => candidate.id !== envelope.id);
  let threads = board.threads;
  let intentions = board.intentions;
  let target: ManualRoutingTarget;
  let kind: CaptureEntry["kind"];
  let targetFragId: string | undefined;

  if (destination.kind === "action") {
    const imageIds = [...(envelope.imgs ?? [])];
    const ownerThreadId = `${base}:image-thread`;
    const ownerFragId = `${base}:image-frag`;
    if (imageIds.length && (occupied.has(ownerThreadId) || occupied.has(ownerFragId))) {
      return conflict(board, captureId, "identity_collision");
    }
    if (imageIds.length) {
      const owner: Thread = {
        id: ownerThreadId,
        name: temporaryThreadTitle(source),
        temporaryName: true,
        summary: "",
        frags: [{
          id: ownerFragId,
          text: source,
          at: envelope.at,
          updatedAt: now,
          imgs: imageIds,
        }],
        updatedAt: now,
      };
      threads = [owner, ...threads];
    }
    const action: Action = {
      id: artifactId,
      text: source,
      src: source,
      done: false,
      at: envelope.at,
      updatedAt: now,
      imgs: [],
      ...(imageIds.length
        ? { shot: { threadId: ownerThreadId, fragId: ownerFragId } }
        : {}),
      shelf: "keep",
      expires: null,
    };
    actions = [action, ...actions];
    target = { kind: "action", id: action.id };
    kind = "action";
  } else if (destination.kind === "intention") {
    const intention: Intention = {
      id: artifactId,
      number: nextNumber(board.intentions),
      rawInput: source,
      expandedIntention: source,
      recommendedActions: [],
      counterIntentions: [],
      imgs: [...(envelope.imgs ?? [])],
      at: envelope.at,
      updatedAt: now,
    };
    intentions = [intention, ...intentions];
    target = { kind: "intention", id: intention.id };
    kind = "intention";
  } else {
    const fragId = selectedThread ? artifactId : `${base}:frag`;
    if (!selectedThread && occupied.has(fragId)) {
      return conflict(board, captureId, "identity_collision");
    }
    const frag: Frag = {
      id: fragId,
      text: source,
      at: envelope.at,
      updatedAt: now,
      imgs: [...(envelope.imgs ?? [])],
    };
    if (selectedThread) {
      threads = board.threads.map((thread) => thread.id === selectedThread.id
        ? { ...thread, updatedAt: now, frags: [...thread.frags, frag] }
        : thread);
      target = { kind: "thread", id: selectedThread.id, fragId, created: false };
    } else {
      const thread: Thread = {
        id: artifactId,
        name: destination.threadName?.trim().slice(0, 100) || temporaryThreadTitle(source),
        temporaryName: true,
        summary: "",
        frags: [frag],
        updatedAt: now,
      };
      threads = [thread, ...board.threads];
      target = { kind: "thread", id: thread.id, fragId, created: true };
    }
    kind = "thread";
    targetFragId = fragId;
  }

  const retiredLedger = board.ledger.map((entry) =>
    entry.id === pending.id ? { ...entry, undone: true, imgs: undefined } : entry
  );
  const settlementArtifacts: NonNullable<CaptureEntry["settlementArtifacts"]> =
    target.kind === "action"
      ? [
          { kind: "action", id: target.id },
          ...(envelope.imgs?.length
            ? [{ kind: "thread" as const, id: `${base}:image-thread` }]
            : []),
        ]
      : target.kind === "intention"
        ? [{ kind: "intention", id: target.id }]
        : target.created
          ? [{ kind: "thread", id: target.id }]
          : [{ kind: "frag", id: target.fragId }];
  const settlement: CaptureEntry = {
    id: ledgerId,
    captureId,
    at: envelope.at,
    raw: pending.raw,
    clean: source,
    kind,
    source: pending.source,
    targetId: target.id,
    ...(targetFragId ? { targetFragId } : {}),
    settledBy: "manual",
    settlementPendingId: pending.id,
    settlementRevision: pendingRevision,
    settlementArtifacts,
    ...(pending.transcript ? { transcript: pending.transcript } : {}),
    ...(envelope.imgs?.length ? { imgs: [...envelope.imgs] } : {}),
  };
  const routingSettlement = {
    id: ledgerId,
    captureId,
    pendingId: pending.id,
    revision: pendingRevision,
    settledBy: "manual" as const,
    artifacts: settlementArtifacts,
  };
  return {
    status: "applied",
    board: {
      ...board,
      actions,
      threads,
      intentions,
      ledger: appendLedger(retiredLedger, settlement),
      routingSettlements: [
        routingSettlement,
        ...(board.routingSettlements ?? []).filter((record) => record.id !== routingSettlement.id),
      ],
    },
    captureId,
    target,
    ledgerId,
    tombstones: [{ kind: "action", id: envelope.id, deletedAt: now }],
  };
}
