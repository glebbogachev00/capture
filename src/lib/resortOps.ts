import type { CaptureOrigin, SaveDraftInput } from "./intentionOps";
import type { CaptureEntry } from "./ledger";
import { sourceOf } from "./ledger";
import type { Action, Board, Principle } from "./model";
import { applySorted, type Applied, type SortResult } from "./boardOps";
import type { SortKind } from "./refiled";
import { semanticSortContext } from "./sortContext";
import { recordSortedCapture } from "./settle";

type RoutingStatus = {
  preferred?: string | null;
  fallback?: boolean;
  fallbackReason?: "rate_limit" | "provider_failure" | null;
};

/** Build the bounded route request from one current Board snapshot. The hook
 * owns timing and authority; this seam owns only request shape and response
 * admission. */
export async function requestBoardSort<T = SortResult>(options: {
  request: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  board: Board;
  raw: string;
  forgottenRules: string[];
  force?: SortKind;
  imageSources?: string[];
  captureId?: string;
  signal?: AbortSignal;
  noteVia: (via?: string | null, routing?: RoutingStatus) => void;
  errorFor: (message?: string) => Error;
}): Promise<T> {
  const context = semanticSortContext(options.board, options.raw, options.forgottenRules);
  const response = await options.request("/api/sort", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    ...(options.signal ? { signal: options.signal } :
      options.captureId ? { signal: AbortSignal.timeout(55_000) } : {}),
    body: JSON.stringify({
      raw: options.raw,
      threads: context.threads,
      ...(options.captureId ? {
        captureId: options.captureId,
        routingPlanVersion: 1,
        actions: options.board.actions
          .filter((action) => !action.unsorted && !action.done && !action.faded)
          .slice(0, 400)
          .map((action) => ({ id: action.id, text: action.text })),
      } : {}),
      recent: context.recent,
      series: context.series ?? undefined,
      force: options.force,
      correctionExamples: context.correctionExamples.map(
        ({ capture, kind, threadId, threadName }) => ({ capture, kind, threadId, threadName }),
      ),
      imgs: options.imageSources?.length ? options.imageSources : undefined,
    }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw options.errorFor(body.error);
  }
  const out = await response.json() as T & { via?: string | null; routing?: RoutingStatus };
  options.noteVia(out.via, out.routing);
  return out;
}

export function pendingEntry(board: Board, actionId: string): CaptureEntry | undefined {
  return board.ledger.find(
    (entry) => entry.kind === "pending" && entry.targetId === actionId
  );
}

/** Return the current envelope only when the model answered the exact revision
    that was sent. A concurrent edit or delete must win over a stale response. */
export function matchingPendingAction(board: Board, expected: Action): Action | undefined {
  const current = board.actions.find((action) =>
    action.id === expected.id && !!action.unsorted === !!expected.unsorted
  );
  if (!current) return undefined;
  const sameImages = (current.imgs ?? []).length === (expected.imgs ?? []).length &&
    (current.imgs ?? []).every((id, index) => id === expected.imgs?.[index]);
  return current.text === expected.text && current.src === expected.src &&
    current.threadId === expected.threadId && current.at === expected.at &&
    current.updatedAt === expected.updatedAt && sameImages
    ? current
    : undefined;
}

/** Preserve a destination explicitly selected before an offline/provider failure. */
export function pinResortDestination(sorted: SortResult, action: Action): SortResult {
  return action.threadId
    ? { ...sorted, threadId: action.threadId, threadName: null }
    : sorted;
}

export function prepareResortedCapture(
  board: Board,
  expected: Action,
  sorted: SortResult,
  mkId: () => string,
) {
  const current = matchingPendingAction(board, expected);
  if (!current) return null;
  const out = pinResortDestination(sorted, current);
  const pending = pendingEntry(board, current.id);
  if (out.kind === "intention") return { kind: "intention" as const, current, out, pending };
  const applied = applySorted(out, current.imgs || [], current.at, {
    ...board,
    actions: board.actions.filter((candidate) => candidate.id !== current.id),
  });
  const recorded = recordResortedCapture(applied, out, current, pending, mkId, board);
  return { kind: "settled" as const, current, out, applied, ...recorded };
}

export function resortIntentionOrigin(
  action: Action,
  pending: CaptureEntry | undefined,
  via?: string
): CaptureOrigin {
  const source = action.src || action.text;
  return {
    raw: pending?.raw ?? source,
    source: pending?.source ?? sourceOf(source, false, !!action.imgs?.length),
    at: pending?.at ?? action.at,
    imgs: action.imgs || [],
    transcript: pending?.transcript,
    captureId: pending?.captureId ?? pending?.id,
    via,
  };
}

export function pendingDraftAction(
  board: Board,
  expected: Action | null,
  sourceId: string | null,
): Action | undefined {
  return expected
    ? sourceId === expected.id ? matchingPendingAction(board, expected) : undefined
    : sourceId
      ? board.actions.find((action) => action.id === sourceId && action.unsorted)
      : undefined;
}

export async function requestIntentionExpansion(
  request: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  rawInput: string,
  principles: Principle[],
  currentBoard: () => Board,
  expectedPending?: Action,
  errorFor: (message?: string) => Error = (message) => new Error(message),
  signal?: AbortSignal,
): Promise<{ draft: SaveDraftInput; via?: string } | null> {
  const response = await request("/api/intention", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    ...(signal ? { signal } : {}),
    body: JSON.stringify({ op: "expand", rawInput, principles }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw errorFor(body.error);
  }
  const out = await response.json() as Partial<SaveDraftInput> & { via?: string };
  if (signal?.aborted ||
      (expectedPending && !matchingPendingAction(currentBoard(), expectedPending))) return null;
  return {
    via: out.via,
    draft: {
      rawInput,
      expandedIntention: out.expandedIntention ?? "",
      recommendedActions: out.recommendedActions ?? [],
      counterIntentions: out.counterIntentions ?? [],
    },
  };
}

export function recordResortedCapture(
  applied: Applied,
  out: SortResult,
  action: Action,
  pending: CaptureEntry | undefined,
  mkId: () => string,
  before: Board,
): { board: Board; summaryTargets: string[] } {
  const raw = action.src || action.text;
  const landed = new Set(applied.landedIds);
  const next = action.threadId && out.kind === "action"
    ? {
        ...applied.next,
        actions: applied.next.actions.map((candidate) =>
          landed.has(candidate.id) ? { ...candidate, threadId: action.threadId } : candidate
        ),
      }
    : applied.next;
  const recorded = recordSortedCapture(
    next,
    {
      raw: pending?.raw ?? raw,
      payload: raw,
      at: pending?.at ?? action.at,
      dictated: pending?.source === "dictated",
      imgIds: action.imgs || [],
      transcript: pending?.transcript,
      captureId: pending?.captureId ?? pending?.id ?? mkId(),
      kind: out.kind,
      clean: out.clean,
      primaryText: out.primaryText,
      via: out.via,
      primary: {
        targetId:
          out.kind === "action"
            ? applied.source?.id ?? applied.next.actions[0]?.id ?? ""
            : applied.source?.id ?? applied.targetId ?? "",
        fragId: applied.source?.fragId,
      },
      summaryThreadIds: [applied.targetId, action.threadId]
        .filter((id): id is string => !!id && next.threads.some((thread) => thread.id === id)),
      also: (applied.alsoLanded ?? []).map((piece) => ({
        text: piece.text,
        threadId: piece.threadId,
        fragId: piece.fragId,
      })),
    },
    mkId
  );
  if (!pending) return recorded;
  const priorLedgerIds = new Set(next.ledger.map((entry) => entry.id));
  const settlementRows = recorded.board.ledger.filter((entry) => !priorLedgerIds.has(entry.id));
  // Ledger rows describe display/provenance targets, not mutation ownership:
  // multi-Action captures have one primary row and `both` has a Thread target.
  // Diff the actual transition, including fragments inside newly made Threads.
  const previousActions = new Set(before.actions.map((item) => item.id));
  const previousIntentions = new Set(before.intentions.map((item) => item.id));
  const previousThreads = new Set(before.threads.map((item) => item.id));
  const previousFrags = new Set(before.threads.flatMap((thread) => thread.frags.map((frag) => frag.id)));
  const artifacts: NonNullable<CaptureEntry["settlementArtifacts"]> = [
    ...next.actions.filter((item) => !previousActions.has(item.id))
      .map((item) => ({ kind: "action" as const, id: item.id })),
    ...next.intentions.filter((item) => !previousIntentions.has(item.id))
      .map((item) => ({ kind: "intention" as const, id: item.id })),
    ...next.threads.filter((item) => !previousThreads.has(item.id))
      .map((item) => ({ kind: "thread" as const, id: item.id })),
    ...next.threads.flatMap((thread) => thread.frags)
      .filter((frag) => !previousFrags.has(frag.id))
      .map((frag) => ({ kind: "frag" as const, id: frag.id })),
  ];
  const settlementId = settlementRows[0]?.id;
  const revision = pending.pendingRevision ?? action.pendingRevision ?? 1;
  return {
    ...recorded,
    board: {
      ...recorded.board,
      ledger: recorded.board.ledger.map((entry) =>
        entry.id === pending.id
          ? { ...entry, undone: true, imgs: undefined }
          : priorLedgerIds.has(entry.id)
            ? entry
            : {
                ...entry,
                settledBy: "automatic" as const,
                settlementPendingId: pending.id,
                settlementRevision: revision,
                settlementArtifacts: artifacts,
              }
      ),
      routingSettlements: settlementId ? [{
        id: settlementId,
        captureId: pending.captureId ?? pending.id,
        pendingId: pending.id,
        revision,
        settledBy: "automatic",
        artifacts,
      }, ...(recorded.board.routingSettlements ?? []).filter((record) => record.id !== settlementId)] : recorded.board.routingSettlements,
    },
  };
}
