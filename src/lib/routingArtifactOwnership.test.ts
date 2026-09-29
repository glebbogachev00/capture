import { describe, expect, it } from "vitest";
import { EMPTY, type Board } from "./model";
import type { SortResult } from "./boardOps";
import { stagePlannedRoutingIntake } from "./plannedRoutingIntake";
import { settlePlannedRouting } from "./plannedRoutingSettlement";
import { settleManualRouting } from "./manualRoutingSettlement";
import { prepareResortedCapture } from "./resortOps";
import { mergeSync, stampChanges, type SyncState } from "./sync";

const raw = "Keep my original thinking.\n  Exact source survives.";
const unrelated = {
  id: "unrelated", name: "Unrelated", summary: "Untouched summary",
  frags: [{ id: "unrelated-frag", text: "Unrelated image", imgs: ["unrelated-image"], at: 10 }],
};
const base: Board = { ...EMPTY, principles: [], threads: [unrelated] };

function intake(board = base, captureId = "race", source = raw, at = 100) {
  return stagePlannedRoutingIntake(board, {
    captureId, raw: source, payload: source, at, dictated: false,
    images: [{ id: `${captureId}-image`, src: "data:image/png;base64,bytes" }],
  }, { itemId: `${captureId}-pending`, ledgerId: `${captureId}-row` }).board;
}

function manualIntention(pending: Board): SyncState {
  const result = settleManualRouting(pending, {
    captureId: "race", pendingId: "race-row", pendingTargetId: "race-pending",
    pendingSource: raw, pendingImageIds: ["race-image"], pendingInputSource: "typed",
    revision: 1, destination: { kind: "intention" }, now: 200,
  });
  expect(result.status, JSON.stringify(result)).toBe("applied");
  if (result.status !== "applied") throw new Error(result.reason);
  return { board: result.board, tombstones: result.tombstones };
}

function resort(pending: Board, captureId: string, out: SortResult) {
  let n = 0;
  const result = prepareResortedCapture(pending,
    pending.actions.find((action) => action.id === `${captureId}-pending`)!,
    out, () => `${captureId}-ledger-${++n}`);
  if (!result || result.kind !== "settled") throw new Error("Expected settled resort");
  return result.board;
}

function plannedThread(pending: Board) {
  const result = settlePlannedRouting(pending, {
    captureId: "race", revision: 1, now: 250,
    plan: {
      items: [{
        id: "thought", source: raw, kind: "developing_thought", action: null,
        due: null, ownerId: null, destinations: [{ type: "new", newThreadKey: "home" }],
        duplicateActionId: null, unresolved: false, ambiguity: null,
      }],
      newThreads: [{ key: "home", name: "Thinking", closestExistingThreadId: "unrelated", whyNew: "No existing subject matches this thinking." }],
    },
    recovery: { kind: "thread", clean: raw, title: "Thinking", actions: [], threadName: "Thinking" },
  });
  expect(result.status, JSON.stringify(result)).toBe("applied");
  if (result.status !== "applied") throw new Error(JSON.stringify(result));
  return result.board;
}

function assertManual(board: Board) {
  expect(board.intentions).toEqual([expect.objectContaining({ rawInput: raw, imgs: ["race-image"] })]);
  expect(board.threads.find((thread) => thread.id === unrelated.id)).toEqual(unrelated);
  expect(board.ledger.find((row) => row.id === "race-row")?.raw).toBe(raw);
  expect(board.ledger.filter((row) => row.captureId === "race" && !row.undone))
    .toEqual([expect.objectContaining({ kind: "intention", settledBy: "manual", raw })]);
}

// Both directions and stale replay exercise production authority, not just manifests.
function mergedAndReplayed(manual: SyncState, automatic: SyncState) {
  return [mergeSync(manual, automatic, 500), mergeSync(automatic, manual, 500)]
    .flatMap((merged) => [merged, mergeSync(merged, automatic, 550), mergeSync(automatic, merged, 550)]);
}

describe("routing artifact ownership under offline manual conflicts", () => {
  it.each(["action", "both"] as const)("%s image re-sort owns new fragments, never preexisting content", (kind) => {
    const pending = intake({
      ...base,
      actions: [{ id: "existing-action", text: "Keep this task", src: "Exact task source", at: 5, done: false, shelf: "keep", expires: null }],
      intentions: [{ id: "existing-intention", number: 1, rawInput: "I keep this", expandedIntention: "I keep this", recommendedActions: [], counterIntentions: [], at: 5, updatedAt: 5 }],
    });
    const automatic = resort(pending, "race", {
      kind, clean: raw, title: "Thinking", actions: ["Call the supplier", "Send the invoice"],
      threadId: unrelated.id, shelfLife: "keep", primaryText: raw,
      also: [{ text: "Another subject", threadId: null, threadName: "Another subject" }],
    });
    const artifacts = automatic.routingSettlements![0].artifacts;
    expect(artifacts).not.toContainEqual({ kind: "thread", id: unrelated.id });
    expect(artifacts).not.toContainEqual({ kind: "frag", id: unrelated.frags[0].id });
    expect(artifacts).not.toContainEqual({ kind: "action", id: "existing-action" });
    expect(artifacts).not.toContainEqual({ kind: "intention", id: "existing-intention" });
    const next = stampChanges(pending, automatic, 250);
    for (const { board } of mergedAndReplayed(manualIntention(pending), next)) {
      expect(board.actions).toEqual(pending.actions.filter((action) => !action.unsorted));
      expect(board.threads).toEqual([expect.objectContaining(unrelated)]);
      expect(board.intentions).toContainEqual(pending.intentions[0]);
      expect(board.intentions.find((intention) => intention.id !== "existing-intention"))
        .toMatchObject({ rawInput: raw, imgs: ["race-image"] });
    }
  });

  it.each(["durable", "ledger-only"])("a legacy Thread-only %s manifest retains unknown content instead of guessing its ownership", (format) => {
    const pending = intake();
    const automatic = plannedThread(pending);
    const home = automatic.threads.find((thread) => thread.id !== unrelated.id)!;
    const laterRaw = "Later independent image";
    const later = resort(intake(automatic, "later", laterRaw, 300), "later", {
      kind: "thread", clean: laterRaw, title: "Thinking", actions: [], threadId: home.id,
    });
    // Serialize the real settlement in the legacy format, which named only
    // the new container. Do not synthesize outcomes or infer fragment ids.
    const legacy: Board = {
      ...later,
      routingSettlements: format === "ledger-only" ? [] : later.routingSettlements?.map((record) => record.captureId === "race"
        ? { ...record, artifacts: record.artifacts.filter((artifact) => artifact.kind !== "frag") } : record),
      ledger: later.ledger.map((row) => row.captureId === "race" && row.settlementArtifacts
        ? { ...row, settlementArtifacts: row.settlementArtifacts.filter((artifact) => artifact.kind !== "frag") } : row),
    };
    const stamped = stampChanges(pending, legacy, 400);
    for (const { board } of mergedAndReplayed(manualIntention(pending), stamped)) {
      expect(board.threads.find((thread) => thread.id === home.id))
        .toEqual(stamped.board.threads.find((thread) => thread.id === home.id));
      expect(board.threads.find((thread) => thread.id === home.id)?.frags.map((frag) => frag.imgs))
        .toEqual([["race-image"], ["later-image"]]);
      assertManual(board);
    }
  });

  it("removes an owned planned Thread only when its last fragment is retired and no independent Action refers to it", () => {
    const pending = intake();
    const automatic = plannedThread(pending);
    for (const { board } of mergedAndReplayed(manualIntention(pending), stampChanges(pending, automatic, 250))) {
      expect(board.threads).toEqual([unrelated]);
      assertManual(board);
    }
  });

  it("keeps an emptied container when an independent text-only Action still refers to it", () => {
    const pending = intake();
    const automatic = plannedThread(pending);
    const home = automatic.threads.find((thread) => thread.id !== unrelated.id)!;
    const laterRaw = "Call about this subject";
    const laterPending = stagePlannedRoutingIntake(automatic, {
      captureId: "later", raw: laterRaw, payload: laterRaw, at: 300,
      images: [], dictated: false, openThreadId: home.id,
    }, { itemId: "later-pending", ledgerId: "later-row" }).board;
    const later = resort(laterPending, "later", {
      kind: "action", clean: laterRaw, title: laterRaw, actions: [laterRaw], shelfLife: "keep",
    });
    for (const { board } of mergedAndReplayed(manualIntention(pending), stampChanges(pending, later, 400))) {
      expect(board.threads.find((thread) => thread.id === home.id)?.frags).toEqual([]);
      expect(board.actions).toEqual([expect.objectContaining({ text: laterRaw, src: laterRaw, threadId: home.id })]);
      assertManual(board);
    }
  });

  it.each(["action", "both"] as const)("retires every %s re-sort artifact, not just its primary ledger target", (kind) => {
    const pending = intake();
    const actions = ["Call the supplier", "Send the invoice"];
    const automatic = resort(pending, "race", {
      kind, clean: raw, title: "Thinking", actions, shelfLife: "keep",
      threadName: "Thinking", primaryText: kind === "both" ? raw : null,
    });
    const createdThread = automatic.threads.find((thread) => thread.id !== unrelated.id)!;
    // Assert topology first: omission of sibling Actions and kind=both is observable after sync.
    for (const { board } of mergedAndReplayed(manualIntention(pending), stampChanges(pending, automatic, 250))) {
      expect(board.actions).toEqual([]);
      expect(board.threads).toEqual([unrelated]);
      assertManual(board);
    }
    expect(automatic.routingSettlements?.[0].artifacts).toEqual(expect.arrayContaining([
      ...automatic.actions.map((action) => ({ kind: "action", id: action.id })),
      { kind: "thread", id: createdThread.id },
      { kind: "frag", id: createdThread.frags[0].id },
    ]));
    expect(automatic.actions.map((action) => action.src)).toEqual(actions);
  });

  it.each([
    ["planned", "action"], ["planned", "thread"],
    ["resort", "action"], ["resort", "thread"],
  ] as const)("%s new Thread preserves a later independent %s capture/image and its references", (producer, laterKind) => {
    const pending = intake();
    const automatic = producer === "planned" ? plannedThread(pending) : resort(pending, "race", {
      kind: "thread", clean: raw, title: "Thinking", actions: [], threadName: "Thinking",
    });
    const home = automatic.threads.find((thread) => thread.id !== unrelated.id)!;
    const laterRaw = "Inspect this independent screenshot";
    const laterPending = intake(automatic, "later", laterRaw, 300);
    const later = resort(laterPending, "later", {
      kind: laterKind, clean: laterRaw, title: laterRaw, actions: laterKind === "action" ? [laterRaw] : [],
      threadId: home.id, shelfLife: "keep",
    });
    const survivor = later.threads.find((thread) => thread.id === home.id)!.frags[1];
    const laterAction = later.actions.find((action) => action.shot?.fragId === survivor.id)!;
    const stamped = stampChanges(pending, later, 400);
    for (const { board } of mergedAndReplayed(manualIntention(pending), stamped)) {
      expect(board.threads.find((thread) => thread.id === home.id)?.frags).toEqual([expect.objectContaining(survivor)]);
      expect(board.actions).toEqual(laterAction ? [expect.objectContaining(laterAction)] : []);
      if (laterAction) expect(board.actions[0].shot).toEqual({ threadId: home.id, fragId: survivor.id });
      expect(board.ledger.find((row) => row.captureId === "later" && !row.undone))
        .toMatchObject({ raw: laterRaw, imgs: ["later-image"] });
      assertManual(board);
    }
    expect(automatic.routingSettlements?.[0].artifacts).toContainEqual({ kind: "frag", id: home.frags[0].id });
  });
});
