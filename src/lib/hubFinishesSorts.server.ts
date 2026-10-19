import "server-only";

import type { Board } from "./model";
import { opsEvent } from "./opsEvent.server";
import { exactPendingSnapshot, snapshotMatchesPending, type PendingRecoverySnapshot } from "./pendingRecovery";
import { requestBoardSort } from "./resortOps";
import type { SimpleSortItem } from "./simpleSort";
import { settleSimpleSort } from "./simpleSortSettlement";
import { getSync, pushSync } from "./syncStore";

/**
 * The hub finishes a sort its device abandoned.
 *
 * A capture is saved and sent at once, then sorted by the device that took
 * it. When the phone locks during those few seconds, the sort is cut off,
 * and only that device may pick it up again — so the capture waited, unsorted
 * on every other screen, until the phone was opened again. A self-hosted hub
 * is always on: after a while it sorts the capture itself, with the same
 * request and the same settlement the device would have used. Settlement
 * ids come from the capture and a settled capture refuses a second
 * settlement, so a phone that wakes later pulls the result and stands down.
 *
 * Text captures only. Photos, captures meant as intentions (which open a
 * preview on the device), and anything older than a day are left to the
 * person.
 */

/** Long enough that the device has clearly stopped; short enough to matter. */
export const ABANDONED_AFTER_MS = 2 * 60_000;
const LEFT_TO_THE_PERSON_AFTER_MS = 24 * 60 * 60_000;
const ATTEMPTS = 2;
const PER_PASS = 3;

type SortRequest = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** Pending text captures no device has finished in time. */
export function abandonedSorts(board: Board, now: number): PendingRecoverySnapshot[] {
  return board.ledger
    .filter((entry) => entry.kind === "pending" && !entry.undone &&
      now - entry.at >= ABANDONED_AFTER_MS && now - entry.at <= LEFT_TO_THE_PERSON_AFTER_MS)
    .map((entry) => exactPendingSnapshot(board, entry.targetId))
    .filter((snapshot): snapshot is PendingRecoverySnapshot => !!snapshot &&
      !snapshot.imageIds.length && snapshot.force !== "intention" &&
      (snapshot.inputSource === "typed" || snapshot.inputSource === "dictated"));
}

const attempts = new Map<string, number>();
let running = false;

/** Sort and settle what was abandoned. Never throws; one pass at a time. */
export async function finishAbandonedSorts(sort: SortRequest, now = Date.now): Promise<void> {
  if (running) return;
  running = true;
  try {
    const { board } = await getSync();
    for (const snapshot of abandonedSorts(board, now()).slice(0, PER_PASS)) {
      const tried = attempts.get(snapshot.captureId) ?? 0;
      if (tried >= ATTEMPTS) continue;
      attempts.set(snapshot.captureId, tried + 1);
      try {
        await finishOne(snapshot, sort, now);
      } catch {
        opsEvent({ event: "self_hosted_sort_finish", outcome: "failure", reason: "provider_unavailable", count: "one" });
      }
    }
  } catch {
    /* The hub could not be read: the next sync tries again. */
  } finally {
    running = false;
  }
}

async function finishOne(snapshot: PendingRecoverySnapshot, sort: SortRequest, now: () => number): Promise<void> {
  const before = await getSync();
  if (!snapshotMatchesPending(snapshot, before.board)) return;
  const response = await requestBoardSort<{ sort?: { items?: SimpleSortItem[] }; via?: string }>({
    request: sort, board: before.board, raw: snapshot.source, forgottenRules: [], force: snapshot.force,
    simple: true, captureId: snapshot.captureId, noteVia: () => {}, errorFor: (message) => new Error(message ?? "sort failed"),
  });
  const items = response.sort?.items;
  if (!items?.length) throw new Error("invalid sort response");
  /* The same checks the device makes before it applies an answer. */
  const commanded = snapshot.force === "thread" ? "thought" : snapshot.force;
  if (commanded && items.some((item) => item.kind !== commanded)) return;
  if (items.every((item) => item.kind === "intention")) return;
  /* Settle on the hub as it is now: a device may have finished meanwhile. */
  const latest = await getSync();
  if (!snapshotMatchesPending(snapshot, latest.board)) return;
  const settled = settleSimpleSort(latest.board, {
    captureId: snapshot.captureId, revision: snapshot.revision, items, now: now(), via: response.via,
  });
  if (settled.status !== "applied") return;
  await pushSync({ board: settled.board, tombstones: [...latest.tombstones, ...settled.tombstones] });
  attempts.delete(snapshot.captureId);
  opsEvent({ event: "self_hosted_sort_finish", outcome: "success", reason: "none", count: "one" });
}
