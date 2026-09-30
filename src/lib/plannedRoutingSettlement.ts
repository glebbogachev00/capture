import { expiryFor, parseDue } from "./due";
import { appendLedger, type CaptureEntry } from "./ledger";
import {
  nextNumber,
  SHELF,
  type Action,
  type Board,
  type Frag,
  type Intention,
  type ShelfLife,
  type Thread,
} from "./model";
import type { SortResult } from "./boardOps";
import type { Tombstone } from "./sync";
import { semanticThreads } from "./threadBrief";
import {
  PlannedRoutingPlanSchema,
  routingOwnerIds,
  validateRoutingPlan,
  type PlannedAtomicItem,
  type PlannedRoutingPlan,
  type RoutingPlanFailure,
} from "./plannedRouting";

export type PlannedSettlementConflictReason =
  | "already_settled"
  | "not_pending"
  | "pending_mismatch"
  | "invalid_plan"
  | "identity_collision";

export type PlannedSettlementInput = {
  captureId: string;
  /** Required by the P3 client. Omitted only by pre-P3 pure callers, which
      address the original pending revision. */
  revision?: number;
  plan: PlannedRoutingPlan;
  recovery: SortResult;
  now: number;
  via?: string;
};

export type PlannedSettlementResult =
  | {
      status: "applied";
      board: Board;
      captureId: string;
      actionIds: string[];
      threadIds: string[];
      intentionIds: string[];
      pendingActionIds: string[];
      ledgerIds: string[];
      summaryThreadIds: string[];
      /** Commit beside the board. It prevents a stale synced envelope from
          reappearing after the classified artifacts land. */
      tombstones: Tombstone[];
    }
  | {
      status: "conflict";
      board: Board;
      captureId: string;
      reason: PlannedSettlementConflictReason;
      failures?: RoutingPlanFailure[];
    };

/** Stable for every JavaScript string, including hostile lone surrogates that
 * make encodeURIComponent throw. The escape marker itself is always escaped,
 * so distinct plan identities cannot collapse onto the same item id. */
const enc = (value: string) => value.replace(/[^A-Za-z0-9.-]/g, (char) =>
  `~${char.charCodeAt(0).toString(16).padStart(4, "0")}~`
);
const settlementLedgerId = (captureId: string) =>
  `planned:${enc(captureId)}:settlement`;
const plannedId = (captureId: string, kind: string, identity: string) =>
  `planned:${enc(captureId)}:${kind}:${enc(identity)}`;

const captureIdentity = (entry: CaptureEntry) => entry.captureId ?? entry.id;

function conflict(
  board: Board,
  captureId: string,
  reason: PlannedSettlementConflictReason,
  failures?: RoutingPlanFailure[]
): PlannedSettlementResult {
  return { status: "conflict", board, captureId, reason, ...(failures ? { failures } : {}) };
}

function ownedSource(
  owner: PlannedAtomicItem,
  items: PlannedAtomicItem[],
  unresolvedIds: Set<string>,
  childKinds: PlannedAtomicItem["kind"][]
): string {
  return items
    .filter((item) =>
      !unresolvedIds.has(item.id) &&
      (item.id === owner.id ||
        (routingOwnerIds(item).includes(owner.id) && childKinds.includes(item.kind)))
    )
    .map((item) => item.source)
    .join("");
}

function unresolvedRuns(items: PlannedAtomicItem[], unresolvedIds: Set<string>) {
  const runs: { key: string; ids: Set<string> }[] = [];
  let current: { key: string; ids: Set<string> } | null = null;
  for (const item of items) {
    if (!unresolvedIds.has(item.id)) {
      current = null;
      continue;
    }
    if (!current) {
      current = { key: item.id, ids: new Set([item.id]) };
      runs.push(current);
    } else {
      current.ids.add(item.id);
    }
  }
  return runs.map((run) => ({
    key: run.key,
    source: items.filter((item) => run.ids.has(item.id) ||
      (item.kind === "deadline" && routingOwnerIds(item).some((id) => run.ids.has(id)))
    ).map((item) => item.source).join(""),
  }));
}

function activePendingFor(board: Board, captureId: string) {
  return board.ledger.filter((entry) =>
    entry.kind === "pending" &&
    !entry.undone &&
    captureIdentity(entry) === captureId
  );
}

/**
 * Apply one already model-owned routing plan as one pure board transition.
 * The function has no persistence or UI side effects: callers either commit
 * the returned board whole or keep the original board whole.
 */
export function settlePlannedRouting(
  board: Board,
  input: PlannedSettlementInput
): PlannedSettlementResult {
  const { captureId, recovery, now } = input;
  const markerId = settlementLedgerId(captureId);
  if (board.ledger.some((entry) => entry.id === markerId)) {
    return conflict(board, captureId, "already_settled");
  }
  if (board.ledger.some((entry) =>
    captureIdentity(entry) === captureId && entry.kind !== "pending" && !entry.undone
  )) {
    return conflict(board, captureId, "already_settled");
  }

  const pendingRows = activePendingFor(board, captureId);
  if (pendingRows.length !== 1) return conflict(board, captureId, "not_pending");
  const pendingRow = pendingRows[0];
  const envelope = board.actions.find((action) =>
    action.id === pendingRow.targetId && action.unsorted
  );
  if (!envelope) return conflict(board, captureId, "not_pending");
  const pendingRevision = pendingRow.pendingRevision ?? 1;
  const envelopeRevision = envelope.pendingRevision ?? 1;
  const expectedRevision = input.revision ?? 1;
  if (expectedRevision !== pendingRevision || envelopeRevision !== pendingRevision) {
    return conflict(board, captureId, "pending_mismatch");
  }
  const raw = envelope.src ?? envelope.text;
  if ((pendingRow.pendingSource ?? pendingRow.raw) !== raw) {
    return conflict(board, captureId, "pending_mismatch");
  }
  const sameImages = (envelope.imgs ?? []).length === (pendingRow.imgs ?? []).length &&
    (envelope.imgs ?? []).every((id, index) => id === pendingRow.imgs?.[index]);
  if (!sameImages) return conflict(board, captureId, "pending_mismatch");

  const parsed = PlannedRoutingPlanSchema.safeParse(input.plan);
  if (!parsed.success) {
    return conflict(board, captureId, "invalid_plan", [{ code: "MALFORMED_PLAN" }]);
  }
  const plan = parsed.data;
  const routableThreads = semanticThreads(board.threads);
  const failures = validateRoutingPlan(plan, {
    captureId,
    raw,
    force: envelope.pendingForce,
    threads: routableThreads.map((thread) => ({
      id: thread.id,
      name: thread.name,
      about: thread.belongs || thread.summary,
    })),
    actions: board.actions
      .filter((action) => !action.unsorted && !action.done && !action.faded)
      .map((action) => ({ id: action.id, text: action.text })),
    recovery,
    now,
  });
  if (failures.length) return conflict(board, captureId, "invalid_plan", failures);

  const unresolvedIds = new Set(
    plan.items.filter((item) => item.unresolved).map((item) => item.id)
  );
  for (const item of plan.items) {
    const owners = routingOwnerIds(item);
    if (owners.length && owners.every((id) => unresolvedIds.has(id))) unresolvedIds.add(item.id);
  }
  const pendingRuns = unresolvedRuns(plan.items, unresolvedIds);
  const generatedThreadIds = new Map(
    plan.newThreads.map((thread) => [
      thread.key,
      plannedId(captureId, "thread", thread.key),
    ])
  );
  const actionItems = plan.items.filter((item) =>
    item.kind === "action" && !unresolvedIds.has(item.id)
  );
  const thoughtItems = plan.items.filter((item) =>
    item.kind === "developing_thought" && !unresolvedIds.has(item.id)
  );
  const intentionItems = plan.items.filter((item) =>
    item.kind === "intention" && !unresolvedIds.has(item.id)
  );

  const actionIds = actionItems
    .filter((item) => !item.duplicateActionId)
    .map((item) => plannedId(captureId, "action", item.id));
  const intentionIds = intentionItems.map((item) =>
    plannedId(captureId, "intention", item.id)
  );
  const pendingActionIds = pendingRuns.map((run) =>
    plannedId(captureId, "pending", run.key)
  );
  const fragIds = thoughtItems.flatMap((item) =>
    item.destinations.map((destination, index) =>
      plannedId(
        captureId,
        "frag",
        `${item.id}:${index}:${destination.type === "existing" ? destination.threadId : destination.newThreadKey}`
      )
    )
  );
  const generatedIds = [
    ...actionIds,
    ...intentionIds,
    ...pendingActionIds,
    ...fragIds,
    ...generatedThreadIds.values(),
  ];
  const generatedLedgerIds = [
    markerId,
    ...actionItems.map((item) => plannedId(captureId, "ledger-action", item.id)),
    ...thoughtItems.flatMap((item) => item.destinations.map((destination) =>
      plannedId(
        captureId,
        "ledger-thread",
        `${item.id}:${destination.type === "existing"
          ? destination.threadId
          : generatedThreadIds.get(destination.newThreadKey)!}`
      )
    )),
    ...intentionItems.map((item) => plannedId(captureId, "ledger-intention", item.id)),
    ...pendingRuns.map((run) => plannedId(captureId, "ledger-pending", run.key)),
  ];
  const currentIds = new Set([
    ...board.actions.filter((action) => action.id !== envelope.id).map((action) => action.id),
    ...board.intentions.map((intention) => intention.id),
    ...board.threads.map((thread) => thread.id),
    ...board.threads.flatMap((thread) => thread.frags.map((frag) => frag.id)),
  ]);
  const currentLedgerIds = new Set(
    board.ledger.filter((entry) => entry.id !== pendingRow.id).map((entry) => entry.id)
  );
  if (
    generatedIds.some((id) => currentIds.has(id)) ||
    new Set(generatedIds).size !== generatedIds.length ||
    generatedLedgerIds.some((id) => currentLedgerIds.has(id))
  ) {
    return conflict(board, captureId, "identity_collision");
  }

  const dueByOwner = new Map(
    plan.items
      .filter((item) =>
        item.kind === "deadline" && !unresolvedIds.has(item.id) && item.ownerId && item.due
      )
      .flatMap((item) => routingOwnerIds(item).map((ownerId) => [ownerId, parseDue(item.due, now)] as const))
  );
  const shelf = recovery.shelfLife && recovery.shelfLife in SHELF
    ? recovery.shelfLife as ShelfLife
    : "keep";
  const span = SHELF[shelf];

  const destinationThreadId = (item: PlannedAtomicItem, destinationIndex: number) => {
    const destination = item.destinations[destinationIndex];
    return destination.type === "existing"
      ? destination.threadId
      : generatedThreadIds.get(destination.newThreadKey)!;
  };

  const primaryThreadId = (() => {
    if (recovery.threadId && routableThreads.some((thread) => thread.id === recovery.threadId)) {
      return recovery.threadId;
    }
    if (recovery.threadName) {
      const match = plan.newThreads.find((thread) =>
        thread.name.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase() ===
        recovery.threadName!.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase()
      );
      if (match) return generatedThreadIds.get(match.key);
    }
    return thoughtItems[0]?.destinations.length
      ? destinationThreadId(thoughtItems[0], 0)
      : undefined;
  })();
  const primaryActions = new Set(
    Array.isArray(recovery.primaryActions)
      ? recovery.primaryActions.filter((value): value is string => typeof value === "string")
      : []
  );

  let actions: Action[] = board.actions.filter((action) => action.id !== envelope.id);
  const createdActions: Action[] = actionItems
    .filter((item) => !item.duplicateActionId)
    .map((item) => {
      const due = dueByOwner.get(item.id) ?? null;
      return {
        id: plannedId(captureId, "action", item.id),
        text: item.action!,
        done: false,
        at: envelope.at,
        updatedAt: now,
        src: ownedSource(item, plan.items, unresolvedIds, ["supporting_context", "deadline"]),
        imgs: [],
        shelf,
        due,
        expires: expiryFor(span, due, now),
        ...(primaryThreadId && primaryActions.has(item.action!)
          ? { threadId: primaryThreadId }
          : {}),
      };
    });
  actions = [...createdActions, ...actions];

  const createdThreads: Thread[] = plan.newThreads.map((thread) => ({
    id: generatedThreadIds.get(thread.key)!,
    name: thread.name,
    summary: "",
    frags: [],
    updatedAt: now,
  }));
  let threads = [...createdThreads, ...board.threads];
  const createdFrags: { item: PlannedAtomicItem; threadId: string; frag: Frag }[] = [];
  for (const item of thoughtItems) {
    const text = ownedSource(item, plan.items, unresolvedIds, ["supporting_context"]);
    item.destinations.forEach((_, index) => {
      const threadId = destinationThreadId(item, index);
      const frag: Frag = {
        id: plannedId(captureId, "frag", `${item.id}:${index}:${
          item.destinations[index].type === "existing"
            ? item.destinations[index].threadId
            : item.destinations[index].newThreadKey
        }`),
        at: envelope.at,
        updatedAt: now,
        text,
        imgs: [],
      };
      createdFrags.push({ item, threadId, frag });
      threads = threads.map((thread) =>
        thread.id === threadId ? { ...thread, frags: [...thread.frags, frag] } : thread
      );
    });
  }

  const firstNumber = nextNumber(board.intentions);
  const createdIntentions: Intention[] = intentionItems.map((item, index) => {
    const source = ownedSource(item, plan.items, unresolvedIds, ["supporting_context"]);
    return {
      id: plannedId(captureId, "intention", item.id),
      number: firstNumber + index,
      rawInput: source,
      expandedIntention: source,
      recommendedActions: [],
      counterIntentions: [],
      imgs: [],
      at: envelope.at,
      updatedAt: now,
    };
  });

  const createdPending: Action[] = pendingRuns.map((run, index) => ({
    id: plannedId(captureId, "pending", run.key),
    text: run.source,
    src: run.source,
    done: false,
    at: envelope.at,
    updatedAt: now,
    shelf: "keep",
    expires: null,
    unsorted: true,
    pendingRevision: expectedRevision + 1,
    ...(envelope.pendingForce ? { pendingForce: envelope.pendingForce } : {}),
    imgs: index === 0 ? [...(envelope.imgs ?? [])] : [],
    ...(envelope.threadId ? { threadId: envelope.threadId } : {}),
  }));

  const hasUnresolved = createdPending.length > 0;
  const hasResolved = actionItems.length > 0 || createdFrags.length > 0 || createdIntentions.length > 0;
  let imageOwner: { targetId: string; targetFragId?: string } | undefined;
  if (!hasUnresolved && envelope.imgs?.length) {
    if (createdFrags.length) {
      const owner = createdFrags[0];
      owner.frag.imgs = [...envelope.imgs];
      imageOwner = { targetId: owner.threadId, targetFragId: owner.frag.id };
    } else if (createdIntentions.length) {
      createdIntentions[0].imgs = [...envelope.imgs];
      imageOwner = { targetId: createdIntentions[0].id };
    } else if (createdActions.length) {
      createdActions[0].imgs = [...envelope.imgs];
      imageOwner = { targetId: createdActions[0].id };
    } else {
      const duplicate = actionItems.find((item) => item.duplicateActionId)?.duplicateActionId;
      if (duplicate) {
        imageOwner = { targetId: duplicate };
        actions = actions.map((action) =>
          action.id === duplicate
            ? { ...action, imgs: [...new Set([...(action.imgs ?? []), ...envelope.imgs!])], updatedAt: now }
            : action
        );
      }
    }
  }
  actions = [...createdActions, ...createdPending, ...actions.filter((action) =>
    !createdActions.some((created) => created.id === action.id)
  )];

  const intentions = [...createdIntentions, ...board.intentions];
  const source = pendingRow.source;
  const baseLedger: CaptureEntry[] = board.ledger.map((entry) =>
    entry.id === pendingRow.id ? { ...entry, undone: true, imgs: undefined } : entry
  );
  const newLedger: CaptureEntry[] = [];
  for (const item of actionItems) {
    newLedger.push({
      id: plannedId(captureId, "ledger-action", item.id),
      captureId,
      at: envelope.at,
      raw: pendingRow.raw,
      clean: ownedSource(item, plan.items, unresolvedIds, ["supporting_context", "deadline"]),
      kind: "action",
      source,
      targetId: item.duplicateActionId ?? plannedId(captureId, "action", item.id),
      settledBy: "automatic",
      modelVia: input.via,
    });
  }
  for (const { item, threadId, frag } of createdFrags) {
    newLedger.push({
      id: plannedId(captureId, "ledger-thread", `${item.id}:${threadId}`),
      captureId,
      at: envelope.at,
      raw: pendingRow.raw,
      clean: frag.text,
      kind: "thread",
      source,
      targetId: threadId,
      targetFragId: frag.id,
      settledBy: "automatic",
      modelVia: input.via,
    });
  }
  createdIntentions.forEach((intention, index) => {
    newLedger.push({
      id: plannedId(captureId, "ledger-intention", intentionItems[index].id),
      captureId,
      at: envelope.at,
      raw: pendingRow.raw,
      clean: intention.rawInput,
      kind: "intention",
      source,
      targetId: intention.id,
      settledBy: "automatic",
      modelVia: input.via,
    });
  });
  createdPending.forEach((pending, index) => {
    newLedger.push({
      id: plannedId(captureId, "ledger-pending", pendingRuns[index].key),
      captureId,
      at: envelope.at,
      raw: pending.src!,
      clean: pending.src!,
      kind: "pending",
      ...(hasResolved ? { partial: true } : {}),
      pendingRevision: expectedRevision + 1,
      source,
      targetId: pending.id,
      imgs: index === 0 && pending.imgs?.length ? [...pending.imgs] : undefined,
    });
  });
  if (!newLedger.length) return conflict(board, captureId, "invalid_plan");
  const settlementArtifacts: NonNullable<CaptureEntry["settlementArtifacts"]> = [
    ...createdActions.map((action) => ({ kind: "action" as const, id: action.id })),
    ...createdPending.map((action) => ({ kind: "action" as const, id: action.id })),
    ...createdIntentions.map((intention) => ({ kind: "intention" as const, id: intention.id })),
    ...createdThreads.map((thread) => ({ kind: "thread" as const, id: thread.id })),
    ...createdFrags.map((created) => ({ kind: "frag" as const, id: created.frag.id })),
  ];
  for (let index = 0; index < newLedger.length; index += 1) {
    newLedger[index] = {
      ...newLedger[index],
      settlementPendingId: pendingRow.id,
      settlementRevision: pendingRevision,
      settlementArtifacts,
      settledBy: "automatic",
    };
  }
  newLedger[0] = {
    ...newLedger[0],
    id: markerId,
    ...(pendingRow.transcript ? { transcript: pendingRow.transcript } : {}),
  };
  if (imageOwner && envelope.imgs?.length) {
    const ownerIndex = newLedger.findIndex((entry) =>
      entry.targetId === imageOwner.targetId &&
      entry.targetFragId === imageOwner.targetFragId
    );
    if (ownerIndex >= 0) {
      newLedger[ownerIndex] = { ...newLedger[ownerIndex], imgs: [...envelope.imgs] };
    }
  }
  let ledger = baseLedger;
  for (const entry of newLedger) ledger = appendLedger(ledger, entry);

  const routingSettlementId = [
    markerId,
    "authority",
    enc(pendingRow.id),
    `r${pendingRevision}`,
    ...settlementArtifacts
      .map((artifact) => `${artifact.kind}.${enc(artifact.id)}`)
      .sort(),
  ].join(":");
  const next: Board = {
    ...board,
    actions,
    threads,
    intentions,
    ledger,
    routingSettlements: [{
      id: routingSettlementId,
      captureId,
      pendingId: pendingRow.id,
      revision: pendingRevision,
      settledBy: "automatic",
      artifacts: settlementArtifacts,
    }, ...(board.routingSettlements ?? []).filter((record) => record.id !== routingSettlementId)],
  };
  return {
    status: "applied",
    board: next,
    captureId,
    actionIds,
    threadIds: createdThreads.map((thread) => thread.id),
    intentionIds,
    pendingActionIds,
    ledgerIds: newLedger.map((entry) => entry.id),
    summaryThreadIds: [...new Set(createdFrags.map((created) => created.threadId))],
    tombstones: [{ kind: "action", id: envelope.id, deletedAt: now }],
  };
}
