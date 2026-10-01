import { expiryFor, parseDue } from "./due";
import { appendLedger, type CaptureEntry } from "./ledger";
import { nextNumber, SHELF, type Action, type Board, type Frag, type Intention, type Thread } from "./model";
import {
  activePendingFor,
  captureIdentity,
  conflict,
  plannedId,
  settlementLedgerId,
  enc,
  type PlannedSettlementResult,
} from "./plannedRoutingSettlement";
import type { SimpleSortItem, SimpleSortTarget } from "./simpleSort";

const nameKey = (name: string) => name.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();

/**
 * Land one sorted capture as one board transition.
 *
 * Same records as every other settlement — ledger entries under the capture
 * id, a settlement marker, the consumed pending envelope — so Undo, receipts
 * and sync treat it like any other landed capture.
 */
export function settleSimpleSort(board: Board, input: {
  captureId: string;
  revision?: number;
  items: SimpleSortItem[];
  now: number;
  via?: string;
}): PlannedSettlementResult {
  const { captureId, items, now } = input;
  const pendingRows = activePendingFor(board, captureId);
  if (pendingRows.length !== 1) return conflict(board, captureId, "not_pending");
  const pendingRow = pendingRows[0];
  /* Ids follow the pending record, not the capture: a capture undone and
     sorted again ("Sort again into…") gets fresh ones, while two devices
     settling the same pending record still agree on every id. */
  const basis = `${captureId}/${pendingRow.id}`;
  const markerId = settlementLedgerId(basis);
  if (board.ledger.some((entry) => entry.id === markerId ||
      (captureIdentity(entry) === captureId && entry.kind !== "pending" && !entry.undone))) {
    return conflict(board, captureId, "already_settled");
  }
  const envelope = board.actions.find((action) => action.id === pendingRow.targetId && action.unsorted);
  if (!envelope) return conflict(board, captureId, "not_pending");
  const revision = pendingRow.pendingRevision ?? 1;
  if ((input.revision ?? 1) !== revision || (envelope.pendingRevision ?? 1) !== revision) {
    return conflict(board, captureId, "pending_mismatch");
  }
  const raw = envelope.src ?? envelope.text;
  if ((pendingRow.pendingSource ?? pendingRow.raw) !== raw) return conflict(board, captureId, "pending_mismatch");
  if (!items.length) return conflict(board, captureId, "invalid_plan");
  /* A Thread chosen before the sort (captured inside it) holds every thought. */
  const pinned = envelope.threadId && board.threads.some((thread) => thread.id === envelope.threadId)
    ? envelope.threadId : null;
  const photos = envelope.imgs ?? [];

  const createdThreads: Thread[] = [];
  const threadFor = (target: SimpleSortTarget): string | null => {
    if (pinned) return pinned;
    if ("id" in target) return board.threads.some((thread) => thread.id === target.id) ? target.id : null;
    const existing = [...createdThreads, ...board.threads].find((thread) => nameKey(thread.name) === nameKey(target.name));
    if (existing) return existing.id;
    const thread: Thread = { id: plannedId(basis, "thread", nameKey(target.name)), name: target.name.trim(), summary: "", frags: [], updatedAt: now };
    createdThreads.push(thread);
    return thread.id;
  };

  const createdActions: Action[] = [];
  const createdIntentions: Intention[] = [];
  const createdFrags: { threadId: string; frag: Frag }[] = [];
  const newLedger: CaptureEntry[] = [];
  const entry = (kind: CaptureEntry["kind"], clean: string, targetId: string, targetFragId?: string): CaptureEntry => ({
    id: plannedId(basis, `ledger-${kind}`, `${newLedger.length}:${targetId}`),
    captureId, at: envelope.at, raw: pendingRow.raw, clean, kind, source: pendingRow.source,
    targetId, ...(targetFragId ? { targetFragId } : {}), settledBy: "automatic", modelVia: input.via,
  });
  let number = nextNumber(board.intentions);
  const repeatedActionIds: string[] = [];
  let unplaced = false;
  items.forEach((item, index) => {
    const repeated = item.kind === "action" && item.existingActionId
      ? board.actions.find((action) => action.id === item.existingActionId && !action.done && !action.unsorted)
      : undefined;
    if (repeated) {
      /* Already on the list: point at it. It is not new, so Undo leaves it. */
      repeatedActionIds.push(repeated.id);
      newLedger.push(entry("action", item.text, repeated.id));
    } else if (item.kind === "action") {
      const due = parseDue(item.due, now);
      const action: Action = {
        id: plannedId(basis, "action", String(index)), text: item.text, done: false,
        at: envelope.at, updatedAt: now, src: raw, imgs: [], shelf: "weeks", due,
        expires: expiryFor(SHELF.weeks, due, now),
      };
      createdActions.push(action);
      newLedger.push(entry("action", item.text, action.id));
    } else if (item.kind === "intention") {
      const intention: Intention = {
        id: plannedId(basis, "intention", String(index)), number: number++,
        rawInput: items.length === 1 ? raw : item.text, expandedIntention: item.text,
        recommendedActions: [], counterIntentions: [], imgs: [], at: envelope.at, updatedAt: now,
      };
      createdIntentions.push(intention);
      newLedger.push(entry("intention", item.text, intention.id));
    } else {
      const threadIds = (item.threads ?? []).map(threadFor);
      if (!threadIds.length || threadIds.some((id) => !id)) unplaced = true;
      for (const threadId of new Set(threadIds.filter((id): id is string => !!id))) {
        /* One capture, one entry per Thread: parts sent to the same Thread join. */
        const same = createdFrags.find((created) => created.threadId === threadId);
        if (same) { same.frag.text = `${same.frag.text} ${item.text}`; continue; }
        const frag: Frag = { id: plannedId(basis, "frag", `${index}:${threadId}`), at: envelope.at, updatedAt: now, text: item.text, imgs: [] };
        createdFrags.push({ threadId, frag });
        newLedger.push(entry("thread", item.text, threadId, frag.id));
      }
    }
  });
  if (!newLedger.length || unplaced) return conflict(board, captureId, "invalid_plan");
  /* Photos stay on the first thought's fragment (or the first intention),
     and each new action points at that fragment. With neither, the capture
     stays unsorted with its photos rather than lose them. */
  const shot = photos.length ? createdFrags[0] : undefined;
  if (photos.length) {
    const home = shot?.frag ?? createdIntentions[0];
    if (!home) return conflict(board, captureId, "invalid_plan");
    home.imgs = [...photos];
    const row = newLedger.find((candidate) => candidate.targetId === (shot ? shot.threadId : home.id) &&
      (!shot || candidate.targetFragId === shot.frag.id));
    if (row) row.imgs = [...photos];
  }
  for (const action of createdActions) {
    if (shot) action.shot = { threadId: shot.threadId, fragId: shot.frag.id };
    if (pinned) action.threadId = pinned;
  }
  for (const row of newLedger) {
    const joined = createdFrags.find((created) => created.frag.id === row.targetFragId);
    if (joined) row.clean = joined.frag.text;
  }

  const artifacts: NonNullable<CaptureEntry["settlementArtifacts"]> = [
    ...createdActions.map((action) => ({ kind: "action" as const, id: action.id })),
    ...createdIntentions.map((intention) => ({ kind: "intention" as const, id: intention.id })),
    ...createdThreads.map((thread) => ({ kind: "thread" as const, id: thread.id })),
    ...createdFrags.map(({ frag }) => ({ kind: "frag" as const, id: frag.id })),
  ];
  const settled = newLedger.map((row, index) => ({
    ...row,
    ...(index === 0 ? { id: markerId, ...(pendingRow.transcript ? { transcript: pendingRow.transcript } : {}) } : {}),
    settlementPendingId: pendingRow.id, settlementRevision: revision, settlementArtifacts: artifacts,
  }));
  let ledger = board.ledger.map((row) => row.id === pendingRow.id ? { ...row, undone: true, imgs: undefined } : row);
  for (const row of settled) ledger = appendLedger(ledger, row);

  const threads = [...createdThreads, ...board.threads].map((thread) => {
    const frags = createdFrags.filter((created) => created.threadId === thread.id).map((created) => created.frag);
    return frags.length ? { ...thread, frags: [...thread.frags, ...frags] } : thread;
  });
  const settlementId = [markerId, "authority", enc(pendingRow.id), `r${revision}`,
    ...artifacts.map((artifact) => `${artifact.kind}.${enc(artifact.id)}`).sort()].join(":");
  return {
    status: "applied",
    board: {
      ...board,
      actions: [...createdActions, ...board.actions.filter((action) => action.id !== envelope.id)],
      threads,
      intentions: [...createdIntentions, ...board.intentions],
      ledger,
      /* A capture that only repeats an open action creates nothing, and a
         settlement must own a live artifact to be a valid board. */
      routingSettlements: artifacts.length ? [{
        id: settlementId, captureId, pendingId: pendingRow.id, revision, settledBy: "automatic", artifacts,
      }, ...(board.routingSettlements ?? []).filter((record) => record.id !== settlementId)] : board.routingSettlements ?? [],
    },
    captureId,
    actionIds: [...createdActions.map((action) => action.id), ...repeatedActionIds],
    threadIds: createdThreads.map((thread) => thread.id),
    intentionIds: createdIntentions.map((intention) => intention.id),
    pendingActionIds: [],
    ledgerIds: settled.map((row) => row.id),
    summaryThreadIds: [...new Set(createdFrags.map((created) => created.threadId))],
    tombstones: [{ kind: "action", id: envelope.id, deletedAt: now }],
  };
}
