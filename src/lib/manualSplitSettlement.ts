import { appendLedger, type CaptureEntry } from "./ledger";
import {
  nextNumber,
  type Action,
  type Board,
  type Frag,
  type Intention,
  type Thread,
} from "./model";
import {
  temporaryThreadTitle,
  type ManualDestination,
  type ManualPendingSnapshot,
} from "./manualRoutingSettlement";
import type { Tombstone } from "./sync";

export type ManualSplitDestination = ManualDestination | { kind: "pending" };

export type ManualSplitSegment = {
  id: string;
  /** Canonical source order. Visible array order is the person's filing order. */
  sourceOrder: number;
  text: string;
  destination: ManualSplitDestination;
};


export type ManualSplitValidationFailure =
  | "too_few_segments"
  | "empty_segment"
  | "duplicate_identity"
  | "missing_destination"
  | "source_mismatch";

export type ManualSplitConflictReason =
  | "already_settled"
  | "not_pending"
  | "pending_mismatch"
  | "invalid_split"
  | "stale_destination"
  | "identity_collision";

export type ManualSplitResult =
  | {
      status: "applied";
      board: Board;
      captureId: string;
      targetIds: string[];
      pendingActionIds: string[];
      ledgerIds: string[];
      summaryThreadIds: string[];
      tombstones: Tombstone[];
    }
  | {
      status: "conflict";
      board: Board;
      captureId: string;
      reason: ManualSplitConflictReason;
      failures?: ManualSplitValidationFailure[];
    };

const enc = (value: string) => value.replace(/[^A-Za-z0-9.-]/g, (char) =>
  `~${char.charCodeAt(0).toString(16).padStart(4, "0")}~`
);
const captureIdentity = (entry: CaptureEntry) => entry.captureId ?? entry.id;
const sameIds = (left: string[] | undefined, right: string[]) =>
  (left ?? []).length === right.length &&
  (left ?? []).every((id, index) => id === right[index]);

export function validateManualSplitDraft(
  source: string,
  segments: ManualSplitSegment[],
): ManualSplitValidationFailure[] {
  const failures = new Set<ManualSplitValidationFailure>();
  if (segments.length < 2) failures.add("too_few_segments");
  if (segments.some((segment) => segment.text.length === 0)) failures.add("empty_segment");
  if (
    new Set(segments.map((segment) => segment.id)).size !== segments.length ||
    new Set(segments.map((segment) => segment.sourceOrder)).size !== segments.length ||
    segments.some((segment) => !segment.id || !Number.isFinite(segment.sourceOrder))
  ) failures.add("duplicate_identity");
  if (segments.some((segment) =>
    segment.destination.kind === "thread" && segment.destination.threadId === ""
  )) failures.add("missing_destination");
  const covered = [...segments]
    .sort((left, right) => left.sourceOrder - right.sourceOrder)
    .map((segment) => segment.text)
    .join("");
  if (covered !== source) failures.add("source_mismatch");
  return [...failures];
}

function conflict(
  board: Board,
  captureId: string,
  reason: ManualSplitConflictReason,
  failures?: ManualSplitValidationFailure[],
): ManualSplitResult {
  return { status: "conflict", board, captureId, reason, ...(failures?.length ? { failures } : {}) };
}

/** Apply one user-authored, mechanically lossless split to the exact pending
 * envelope shown. The caller persists the returned board and tombstones in the
 * shared durable transaction lane. */
export function settleManualSplitForAction(
  board: Board,
  shown: ManualPendingSnapshot,
  segments: ManualSplitSegment[],
  now: number,
): ManualSplitResult {
  const captureId = shown.captureId;
  const pendingRows = board.ledger.filter((entry) =>
    entry.kind === "pending" && !entry.undone && entry.targetId === shown.targetId
  );
  if (pendingRows.length !== 1) return conflict(board, captureId, "pending_mismatch");
  const pending = pendingRows[0];
  const envelope = board.actions.find((action) => action.id === shown.targetId && action.unsorted);
  if (!envelope) return conflict(board, captureId, "pending_mismatch");

  const revision = shown.revision;
  const source = envelope.src ?? envelope.text;
  if (
    shown.id !== shown.targetId ||
    (shown.src ?? shown.text) !== shown.source ||
    (shown.pendingRevision ?? 1) !== revision ||
    !sameIds(shown.imgs, shown.imageIds) ||
    pending.id !== shown.pendingId ||
    captureIdentity(pending) !== captureId ||
    pending.targetId !== shown.targetId ||
    pending.source !== shown.inputSource ||
    (pending.pendingRevision ?? 1) !== revision ||
    (pending.pendingSource ?? pending.clean) !== shown.source ||
    !sameIds(pending.imgs, shown.imageIds) ||
    source !== shown.source ||
    (envelope.pendingRevision ?? 1) !== revision ||
    !sameIds(envelope.imgs, shown.imageIds)
  ) return conflict(board, captureId, "pending_mismatch");

  const hasClassifiedSettlement = board.ledger.some((entry) =>
    captureIdentity(entry) === captureId && entry.kind !== "pending" && !entry.undone
  );
  if (hasClassifiedSettlement && !pending.partial) {
    return conflict(board, captureId, "already_settled");
  }

  const failures = validateManualSplitDraft(source, segments);
  if (failures.length) return conflict(board, captureId, "invalid_split", failures);

  for (const segment of segments) {
    const destination = segment.destination;
    if (
      destination.kind === "thread" &&
      destination.threadId &&
      !board.threads.some((thread) => thread.id === destination.threadId)
    ) return conflict(board, captureId, "stale_destination");
  }

  const base = `manual-split:${enc(captureId)}:${enc(pending.id)}:r${revision}`;
  const artifactId = (segment: ManualSplitSegment) => `${base}:item:${enc(segment.id)}`;
  const fragmentId = (segment: ManualSplitSegment) => `${base}:frag:${enc(segment.id)}`;
  const ledgerId = (segment: ManualSplitSegment) => `${base}:ledger:${enc(segment.id)}`;
  const attachmentLedgerId = `${base}:attachments`;
  const generatedArtifactIds = segments.flatMap((segment) => {
    if (segment.destination.kind === "thread") {
      return segment.destination.threadId
        ? [fragmentId(segment)]
        : [artifactId(segment), fragmentId(segment)];
    }
    return [artifactId(segment)];
  });
  const occupied = new Set([
    ...board.actions.filter((action) => action.id !== envelope.id).map((action) => action.id),
    ...board.intentions.map((intention) => intention.id),
    ...board.threads.map((thread) => thread.id),
    ...board.threads.flatMap((thread) => thread.frags.map((frag) => frag.id)),
  ]);
  const generatedLedgerIds = [
    ...segments.map(ledgerId),
    ...((envelope.imgs?.length ?? 0) ? [attachmentLedgerId] : []),
  ];
  const occupiedLedger = new Set(board.ledger.filter((entry) => entry.id !== pending.id).map((entry) => entry.id));
  if (
    new Set(generatedArtifactIds).size !== generatedArtifactIds.length ||
    generatedArtifactIds.some((id) => occupied.has(id)) ||
    new Set(generatedLedgerIds).size !== generatedLedgerIds.length ||
    generatedLedgerIds.some((id) => occupiedLedger.has(id))
  ) return conflict(board, captureId, "identity_collision");

  const nextRevision = revision + 1;
  const createdActions: Action[] = [];
  const createdIntentions: Intention[] = [];
  const createdThreads: Thread[] = [];
  const appendedFragments = new Map<string, Frag[]>();
  const newLedger: CaptureEntry[] = [];
  const targetIds: string[] = [];
  const pendingActionIds: string[] = [];
  const summaryThreadIds: string[] = [];
  let nextIntentionNumber = nextNumber(board.intentions);

  for (const segment of segments) {
    const id = artifactId(segment);
    const commonLedger = {
      id: ledgerId(segment),
      captureId,
      at: envelope.at,
      raw: pending.raw,
      clean: segment.text,
      source: pending.source,
      ...(pending.transcript ? { transcript: pending.transcript } : {}),
    } as const;
    if (segment.destination.kind === "pending") {
      createdActions.push({
        id,
        text: segment.text,
        src: segment.text,
        done: false,
        at: envelope.at,
        updatedAt: now,
        imgs: [],
        shelf: "keep",
        expires: null,
        unsorted: true,
        pendingRevision: nextRevision,
        ...(envelope.threadId ? { threadId: envelope.threadId } : {}),
      });
      newLedger.push({
        ...commonLedger,
        kind: "pending",
        partial: true,
        pendingRevision: nextRevision,
        pendingSource: segment.text,
        targetId: id,
      });
      targetIds.push(id);
      pendingActionIds.push(id);
      continue;
    }
    if (segment.destination.kind === "action") {
      createdActions.push({
        id,
        text: segment.text,
        src: segment.text,
        done: false,
        at: envelope.at,
        updatedAt: now,
        imgs: [],
        shelf: "keep",
        expires: null,
      });
      newLedger.push({ ...commonLedger, kind: "action", targetId: id, settledBy: "manual" });
      targetIds.push(id);
      continue;
    }
    if (segment.destination.kind === "intention") {
      const intention: Intention = {
        id,
        number: nextIntentionNumber++,
        rawInput: segment.text,
        expandedIntention: segment.text,
        recommendedActions: [],
        counterIntentions: [],
        imgs: [],
        at: envelope.at,
        updatedAt: now,
      };
      createdIntentions.push(intention);
      newLedger.push({ ...commonLedger, kind: "intention", targetId: id, settledBy: "manual" });
      targetIds.push(id);
      continue;
    }

    const frag: Frag = {
      id: fragmentId(segment),
      text: segment.text,
      at: envelope.at,
      updatedAt: now,
      imgs: [],
    };
    const threadId = segment.destination.threadId ?? id;
    if (segment.destination.threadId) {
      appendedFragments.set(threadId, [...(appendedFragments.get(threadId) ?? []), frag]);
    } else {
      createdThreads.push({
        id: threadId,
        name: temporaryThreadTitle(segment.text),
        temporaryName: true,
        summary: "",
        frags: [frag],
        updatedAt: now,
      });
    }
    newLedger.push({
      ...commonLedger,
      kind: "thread",
      targetId: threadId,
      targetFragId: frag.id,
      settledBy: "manual",
    });
    targetIds.push(threadId);
    summaryThreadIds.push(threadId);
  }

  const imageIds = [...(envelope.imgs ?? [])];
  const settlementArtifacts: NonNullable<CaptureEntry["settlementArtifacts"]> = [
    ...createdActions
      .filter((action) => !action.unsorted)
      .map((action) => ({ kind: "action" as const, id: action.id })),
    ...createdIntentions.map((intention) => ({ kind: "intention" as const, id: intention.id })),
    ...createdThreads.map((thread) => ({ kind: "thread" as const, id: thread.id })),
    ...[...appendedFragments.values()].flat()
      .map((frag) => ({ kind: "frag" as const, id: frag.id })),
  ];
  for (let index = 0; index < newLedger.length; index += 1) {
    if (newLedger[index].kind === "pending") continue;
    newLedger[index] = {
      ...newLedger[index],
      settlementPendingId: pending.id,
      settlementRevision: revision,
      settlementArtifacts,
    };
  }
  const attachmentOwner: Action | null = imageIds.length ? {
    ...envelope,
    text: "",
    src: "",
    pendingRevision: nextRevision,
    updatedAt: now,
    imgs: imageIds,
  } : null;
  if (attachmentOwner) {
    newLedger.push({
      id: attachmentLedgerId,
      captureId,
      at: envelope.at,
      raw: pending.raw,
      clean: "",
      kind: "pending",
      partial: true,
      pendingRevision: nextRevision,
      pendingSource: "",
      source: pending.source,
      targetId: envelope.id,
      imgs: imageIds,
      ...(pending.transcript ? { transcript: pending.transcript } : {}),
      ...(pending.openThreadId ? { openThreadId: pending.openThreadId } : {}),
    });
    pendingActionIds.push(envelope.id);
  }

  let ledger = board.ledger.map((entry) =>
    entry.id === pending.id ? { ...entry, undone: true, imgs: undefined } : entry
  );
  for (const entry of newLedger) ledger = appendLedger(ledger, entry);
  const threads = [
    ...createdThreads,
    ...board.threads.map((thread) => {
      const additions = appendedFragments.get(thread.id);
      return additions
        ? { ...thread, frags: [...thread.frags, ...additions], updatedAt: now }
        : thread;
    }),
  ];
  const actions = [
    ...createdActions,
    ...(attachmentOwner ? [attachmentOwner] : []),
    ...board.actions.filter((action) => action.id !== envelope.id),
  ];
  const tombstones: Tombstone[] = attachmentOwner
    ? []
    : [{ kind: "action", id: envelope.id, deletedAt: now }];
  const settlementId = newLedger.find((entry) => entry.kind !== "pending")?.id;

  return {
    status: "applied",
    board: {
      ...board,
      actions,
      threads,
      intentions: [...createdIntentions, ...board.intentions],
      ledger,
      routingSettlements: settlementId ? [{
        id: settlementId,
        captureId,
        pendingId: pending.id,
        revision,
        settledBy: "manual",
        artifacts: settlementArtifacts,
      }, ...(board.routingSettlements ?? []).filter((record) => record.id !== settlementId)] : board.routingSettlements,
    },
    captureId,
    targetIds,
    pendingActionIds,
    ledgerIds: newLedger.map((entry) => entry.id),
    summaryThreadIds: [...new Set(summaryThreadIds)],
    tombstones,
  };
}
