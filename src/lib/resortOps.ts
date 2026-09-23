import type { CaptureOrigin, SaveDraftInput } from "./intentionOps";
import type { CaptureEntry } from "./ledger";
import { sourceOf } from "./ledger";
import type { Action, Board, Principle } from "./model";
import { pinSortedThreadDestination, type Applied, type SortResult } from "./boardOps";
import { recordSortedCapture } from "./settle";

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
export function pinResortDestination(
  sorted: SortResult,
  action: Action,
  latestBoard: Board,
): SortResult | null {
  if (!action.threadId || sorted.kind === "intention") return sorted;
  return pinSortedThreadDestination({
    ...sorted,
    primaryOwnsImages: action.imgs?.length ? true : sorted.primaryOwnsImages,
  }, action.threadId, latestBoard);
}

export function resortIntentionOrigin(
  action: Action,
  pending: CaptureEntry | undefined,
  via?: string
): CaptureOrigin {
  const raw = action.src || action.text;
  return {
    raw,
    source: pending?.source ?? sourceOf(raw, false, !!action.imgs?.length),
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
): Promise<{ draft: SaveDraftInput; via?: string } | null> {
  const response = await request("/api/intention", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ op: "expand", rawInput, principles }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw errorFor(body.error);
  }
  const out = await response.json() as Partial<SaveDraftInput> & { via?: string };
  if (expectedPending && !matchingPendingAction(currentBoard(), expectedPending)) return null;
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
  mkId: () => string
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
  return recordSortedCapture(
    next,
    {
      raw,
      payload: raw,
      at: pending?.at ?? action.at,
      dictated: pending?.source === "dictated",
      imgIds: action.imgs || [],
      transcript: pending?.transcript,
      captureId: pending?.captureId ?? pending?.id ?? mkId(),
      kind: out.kind,
      clean: out.clean,
      primaryText: out.primaryText,
      primaryOwnsImages: out.kind === "action" || out.primaryOwnsImages,
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
        ownsImages: piece.ownsImages,
      })),
    },
    mkId
  );
}
