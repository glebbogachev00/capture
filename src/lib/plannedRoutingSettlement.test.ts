import { describe, expect, it } from "vitest";
import type { SortResult } from "./boardOps";
import { LEDGER_CAP, mergeLedgers, type CaptureEntry } from "./ledger";
import { EMPTY, hydrate, type Action, type Board } from "./model";
import { validateRoutingPlan, type PlannedRoutingPlan } from "./plannedRouting";
import { exactPendingSnapshot, createPendingRecoveryRecord, claimPendingRecovery } from "./pendingRecovery";
import { settlePlannedRouting } from "./plannedRoutingSettlement";
import { applyTombstones, mergeBoards } from "./sync";

const at = new Date("2026-09-26T10:00:00+07:00").getTime();
const now = new Date("2026-09-26T12:00:00+07:00").getTime();
const captureId = "capture-p2";
const raw =
  "Capture needs quieter filing. Retake playback stalls. Draft two labels tomorrow. The final home of this aside is unclear.";

const waiting: Action = {
  id: "waiting",
  text: raw,
  src: raw,
  done: false,
  at,
  updatedAt: at,
  shelf: "keep",
  expires: null,
  unsorted: true,
  imgs: ["photo"],
};

const board = (over: Partial<Board> = {}): Board => ({
  ...EMPTY,
  principles: [],
  actions: [waiting],
  threads: [
    { id: "capture", name: "Capture filing", summary: "", frags: [] },
    { id: "retake", name: "Retake workflow", summary: "", frags: [] },
  ],
  ledger: [{
    id: "pending-original",
    captureId,
    at,
    raw,
    clean: raw,
    kind: "pending",
    source: "typed",
    targetId: waiting.id,
    imgs: ["photo"],
  }],
  ...over,
});

const recovery: SortResult = {
  clean: raw,
  kind: "both",
  title: "Capture and Retake",
  actions: ["Draft two labels tomorrow"],
  primaryActions: ["Draft two labels tomorrow"],
  shelfLife: "keep",
  due: null,
  threadId: "capture",
  threadName: null,
  primaryText: "Capture needs quieter filing.",
  also: [{ text: "Retake playback stalls.", threadId: "retake", threadName: null }],
};

const plan: PlannedRoutingPlan = {
  items: [
    {
      id: "capture-thought",
      source: "Capture needs quieter filing. ",
      kind: "developing_thought",
      action: null,
      due: null,
      ownerId: null,
      destinations: [{ type: "existing", threadId: "capture" }],
      duplicateActionId: null,
      unresolved: false,
      ambiguity: null,
    },
    {
      id: "retake-thought",
      source: "Retake playback stalls. ",
      kind: "developing_thought",
      action: null,
      due: null,
      ownerId: null,
      destinations: [
        { type: "existing", threadId: "retake" },
        { type: "existing", threadId: "capture" },
      ],
      duplicateActionId: null,
      unresolved: false,
      ambiguity: null,
    },
    {
      id: "labels-action",
      source: "Draft two labels",
      kind: "action",
      action: "Draft two labels tomorrow",
      due: null,
      ownerId: null,
      destinations: [],
      duplicateActionId: null,
      unresolved: false,
      ambiguity: null,
    },
    {
      id: "labels-deadline",
      source: " tomorrow. ",
      kind: "deadline",
      action: null,
      due: "2026-09-27",
      ownerId: "labels-action",
      destinations: [],
      duplicateActionId: null,
      unresolved: false,
      ambiguity: null,
    },
    {
      id: "unclear-aside",
      source: "The final home of this aside is unclear.",
      kind: "developing_thought",
      action: null,
      due: null,
      ownerId: null,
      destinations: [],
      duplicateActionId: null,
      unresolved: true,
      ambiguity: "The source does not establish one destination.",
    },
  ],
  newThreads: [],
};

describe("atomic planned-routing settlement", () => {
  it.each(["action", "thread", "intention"] as const)(
    "rejects a directly submitted plan that contradicts /%s without mutating the board",
    (force) => {
      const before = board({ actions: [{ ...waiting, pendingForce: force }] });
      const result = settlePlannedRouting(before, { captureId, plan, recovery, now });
      expect(result).toMatchObject({ status: "conflict", reason: "invalid_plan" });
      if (result.status !== "conflict") return;
      expect(result.failures).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "COMMAND_KIND_CONFLICT" }),
      ]));
      expect(result.board).toBe(before);
    },
  );

  it.each(["action", "thread", "intention"] as const)(
    "preserves /%s on every unresolved and partial replacement through reload and retry snapshots",
    (force) => {
      for (const partial of [false, true]) {
        const sources = ["Unclear opening. ", "Keep this middle. ", "Unclear ending."];
        const source = sources.join("");
        const before = board({
          actions: [{ ...waiting, text: source, src: source, pendingForce: force }],
          ledger: board().ledger.map((row) => ({ ...row, raw: source, clean: source })),
        });
        const commandedPlan: PlannedRoutingPlan = {
          newThreads: [],
          items: sources.map((span, index) => ({
            id: `span-${index}`, source: span,
            kind: force === "thread" ? "developing_thought" : force,
            action: force === "action" ? span.trim() : null,
            due: null, ownerId: null, duplicateActionId: null,
            destinations: partial && index === 1 && force === "thread"
              ? [{ type: "existing", threadId: "capture" }] : [],
            unresolved: !partial || index !== 1,
            ambiguity: !partial || index !== 1 ? "No safe home." : null,
          })),
        };
        const result = settlePlannedRouting(before, { captureId, plan: commandedPlan, recovery, now });
        expect(result.status).toBe("applied");
        if (result.status !== "applied") return;
        const reloaded = hydrate(JSON.parse(JSON.stringify(result.board)));
        const pending = reloaded.actions.filter((action) => action.unsorted);
        expect(pending).toHaveLength(partial ? 2 : 1);
        for (const replacement of pending) {
          expect(replacement).toMatchObject({ pendingForce: force, pendingRevision: 2 });
          const snapshot = exactPendingSnapshot(reloaded, replacement.id)!;
          expect(snapshot).toMatchObject({ force, revision: 2, source: replacement.src });
          const record = createPendingRecoveryRecord(snapshot, 0, now);
          const claimed = claimPendingRecovery([record], reloaded, record.id, now)!;
          expect(claimed.snapshot.force).toBe(force);
          const contradictory: PlannedRoutingPlan = {
            newThreads: [],
            items: [{ ...plan.items[0], id: "contradictory", source: snapshot.source,
              kind: force === "action" ? "intention" : "action",
              action: force === "action" ? null : snapshot.source, destinations: [] }],
          };
          for (const retry of [snapshot, claimed.snapshot]) {
            expect(validateRoutingPlan(contradictory, {
              captureId, raw: retry.source, force: retry.force, threads: [], actions: [], recovery, now,
            })).toContainEqual({ code: "COMMAND_KIND_CONFLICT", itemId: "contradictory" });
          }
        }
      }
    },
  );

  it("treats a temporary Thread id as unroutable until the person renames it", () => {
    const temporaryBoard = board({
      threads: board().threads.map((thread) => thread.id === "capture"
        ? { ...thread, name: "Temporary — Capture needs quieter", temporaryName: true }
        : thread),
    });
    const hidden = settlePlannedRouting(temporaryBoard, {
      captureId,
      plan,
      recovery,
      now,
      via: "synthetic-planner",
    });
    expect(hidden).toMatchObject({ status: "conflict", reason: "invalid_plan" });
    expect(hidden.board).toBe(temporaryBoard);

    const renamedBoard = board({
      threads: temporaryBoard.threads.map((thread) => thread.id === "capture"
        ? { ...thread, name: "Capture filing", temporaryName: undefined }
        : thread),
    });
    expect(settlePlannedRouting(renamedBoard, {
      captureId,
      plan,
      recovery,
      now,
      via: "synthetic-planner",
    }).status).toBe("applied");
  });

  it("settles every understood item once and leaves only the exact unresolved span pending", () => {
    const result = settlePlannedRouting(board(), {
      captureId,
      plan,
      recovery,
      now,
      via: "synthetic-planner",
    });

    expect(result.status).toBe("applied");
    if (result.status !== "applied") return;

    expect(result.board.actions).toEqual([
      expect.objectContaining({
        text: "Draft two labels tomorrow",
        src: "Draft two labels tomorrow. ",
        due: new Date(2026, 8, 27, 23, 59).getTime(),
        threadId: "capture",
      }),
      expect.objectContaining({
        text: "The final home of this aside is unclear.",
        src: "The final home of this aside is unclear.",
        unsorted: true,
        imgs: ["photo"],
      }),
    ]);
    expect(result.board.actions.some((action) => action.id === waiting.id)).toBe(false);

    expect(result.board.threads.find((thread) => thread.id === "capture")?.frags.map((frag) => frag.text))
      .toEqual(["Capture needs quieter filing. Retake playback stalls. "]);
    expect(result.board.threads.find((thread) => thread.id === "retake")?.frags.map((frag) => frag.text))
      .toEqual(["Retake playback stalls. "]);

    const activePending = result.board.ledger.filter((entry) =>
      entry.kind === "pending" && !entry.undone
    );
    expect(activePending).toHaveLength(1);
    expect(activePending[0]).toMatchObject({
      captureId,
      raw: "The final home of this aside is unclear.",
      clean: "The final home of this aside is unclear.",
      imgs: ["photo"],
    });
    expect(result.board.ledger.find((entry) => entry.id === "pending-original"))
      .toMatchObject({ undone: true, imgs: undefined });
    expect(result.board.ledger.filter((entry) => entry.kind !== "pending"))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({
          captureId,
          kind: "action",
          modelVia: "synthetic-planner",
          settledBy: "automatic",
        }),
        expect.objectContaining({ captureId, kind: "thread", targetId: "capture" }),
        expect.objectContaining({ captureId, kind: "thread", targetId: "retake" }),
      ]));
    expect(plan.items.map((item) => item.source).join("")).toBe(raw);
    expect(result.summaryThreadIds.sort()).toEqual(["capture", "retake"]);

    const retry = settlePlannedRouting(result.board, {
      captureId,
      plan,
      recovery,
      now: now + 1,
    });
    expect(retry).toMatchObject({ status: "conflict", reason: "already_settled" });
    expect(retry.board).toBe(result.board);
  });

  it("represents a mixed Intention, Action, and new Thread without inventing intention details", () => {
    const mixedRaw =
      "My intention: I protect room for rest. Capture planning needs a home. Email Mia tomorrow.";
    const mixedWaiting: Action = {
      ...waiting,
      id: "mixed-waiting",
      text: mixedRaw,
      src: mixedRaw,
      imgs: ["mixed-photo"],
    };
    const mixedBoard = board({
      actions: [mixedWaiting],
      ledger: [{
        id: "mixed-pending",
        captureId: "mixed-capture",
        at,
        raw: mixedRaw,
        clean: mixedRaw,
        kind: "pending",
        source: "typed",
        targetId: mixedWaiting.id,
        imgs: ["mixed-photo"],
      }],
    });
    const mixedRecovery: SortResult = {
      clean: mixedRaw,
      kind: "both",
      title: "Rest and planning",
      actions: ["Email Mia tomorrow"],
      primaryActions: [],
      shelfLife: "keep",
      due: null,
      threadId: null,
      threadName: "Capture planning map",
      primaryText: "Capture planning needs a home.",
      also: [],
    };
    const mixedPlan: PlannedRoutingPlan = {
      items: [
        {
          id: "rest-intention",
          source: "My intention: I protect room for rest. ",
          kind: "intention",
          action: null,
          due: null,
          ownerId: null,
          destinations: [],
          duplicateActionId: null,
          unresolved: false,
          ambiguity: null,
        },
        {
          id: "planning-thought",
          source: "Capture planning needs a home. ",
          kind: "developing_thought",
          action: null,
          due: null,
          ownerId: null,
          destinations: [{ type: "new", newThreadKey: "planning" }],
          duplicateActionId: null,
          unresolved: false,
          ambiguity: null,
        },
        {
          id: "email-action",
          source: "Email Mia",
          kind: "action",
          action: "Email Mia tomorrow",
          due: null,
          ownerId: null,
          destinations: [],
          duplicateActionId: null,
          unresolved: false,
          ambiguity: null,
        },
        {
          id: "email-deadline",
          source: " tomorrow.",
          kind: "deadline",
          action: null,
          due: "2026-09-27",
          ownerId: "email-action",
          destinations: [],
          duplicateActionId: null,
          unresolved: false,
          ambiguity: null,
        },
      ],
      newThreads: [{
        key: "planning",
        name: "Capture planning map",
        closestExistingThreadId: "capture",
        whyNew: "The plan declares a separate synthetic subject.",
      }],
    };

    const result = settlePlannedRouting(mixedBoard, {
      captureId: "mixed-capture",
      plan: mixedPlan,
      recovery: mixedRecovery,
      now,
    });

    expect(result.status).toBe("applied");
    if (result.status !== "applied") return;
    expect(result.board.intentions).toEqual([
      expect.objectContaining({
        rawInput: "My intention: I protect room for rest. ",
        expandedIntention: "My intention: I protect room for rest. ",
        recommendedActions: [],
        counterIntentions: [],
      }),
    ]);
    expect(result.board.actions).toEqual([
      expect.objectContaining({ text: "Email Mia tomorrow" }),
    ]);
    const fresh = result.board.threads.find((thread) => thread.name === "Capture planning map");
    expect(fresh?.frags).toEqual([
      expect.objectContaining({
        text: "Capture planning needs a home. ",
        imgs: ["mixed-photo"],
      }),
    ]);
    expect(result.board.ledger.find((entry) => entry.imgs?.includes("mixed-photo")))
      .toMatchObject({ targetId: fresh?.id, targetFragId: fresh?.frags[0].id });
    expect(result.board.ledger.filter((entry) => entry.captureId === "mixed-capture" && !entry.undone)
      .map((entry) => entry.kind).sort()).toEqual(["action", "intention", "thread"]);
  });

  it("keeps a partial unresolved remainder outside the rolling ledger cap", () => {
    const result = settlePlannedRouting(board(), {
      captureId,
      plan,
      recovery,
      now,
    });
    expect(result.status).toBe("applied");
    if (result.status !== "applied") return;
    const pending = result.board.ledger.find((entry) => entry.kind === "pending" && !entry.undone)!;
    const settled: CaptureEntry[] = Array.from({ length: LEDGER_CAP + 10 }, (_, index) => ({
      id: `later-${index}`,
      at: now + index + 1,
      raw: `later ${index}`,
      clean: `later ${index}`,
      kind: "action",
      source: "typed",
      targetId: `later-action-${index}`,
    }));

    expect(mergeLedgers(result.board.ledger, settled)).toContainEqual(pending);
  });

  it("returns the pending-envelope retirement with the board so a stale Cloud copy cannot resurrect it", () => {
    const before = board();
    const result = settlePlannedRouting(before, {
      captureId,
      plan,
      recovery,
      now,
    });
    expect(result.status).toBe("applied");
    if (result.status !== "applied") return;

    const reloaded = hydrate(JSON.parse(JSON.stringify(result.board)));
    const staleCloudMerge = mergeBoards(reloaded, before);
    const reconciled = applyTombstones(staleCloudMerge, result.tombstones);

    expect(reconciled.actions.some((action) => action.id === waiting.id)).toBe(false);
    expect(reconciled.actions.filter((action) => action.unsorted).map((action) => action.text))
      .toEqual(["The final home of this aside is unclear."]);
    expect(reconciled.ledger.find((entry) => entry.id === "pending-original"))
      .toMatchObject({ undone: true, imgs: undefined });
    const semanticState = (candidate: Board) => ({
      actions: candidate.actions.map((action) => ({
        id: action.id,
        text: action.text,
        due: action.due,
        unsorted: !!action.unsorted,
        threadId: action.threadId,
        imgs: action.imgs,
      })),
      threads: candidate.threads.map((thread) => ({
        id: thread.id,
        name: thread.name,
        frags: thread.frags.map((frag) => ({ id: frag.id, text: frag.text, imgs: frag.imgs })),
      })),
      intentions: candidate.intentions,
    });
    expect(semanticState(reconciled)).toEqual(semanticState(reloaded));
  });

  it("keeps discontiguous unresolved spans exact while settling existing and new Thread context", () => {
    const splitRaw =
      "Unclear opening. Capture routing stays atomic because retries happen. A new planning lane needs its own home. Unclear ending.";
    const splitWaiting = {
      ...waiting,
      id: "split-waiting",
      text: splitRaw,
      src: splitRaw,
      imgs: ["split-photo"],
    };
    const splitBoard = board({
      actions: [splitWaiting],
      ledger: [{
        id: "split-pending",
        captureId: "split-capture",
        at,
        raw: splitRaw,
        clean: splitRaw,
        kind: "pending",
        source: "typed",
        targetId: splitWaiting.id,
        imgs: ["split-photo"],
      }],
    });
    const splitRecovery: SortResult = {
      clean: splitRaw,
      kind: "thread",
      title: "Atomic routing",
      actions: [],
      primaryActions: [],
      shelfLife: "keep",
      due: null,
      threadId: "capture",
      threadName: null,
      primaryText: "Capture routing stays atomic because retries happen.",
      also: [{
        text: "A new planning lane needs its own home.",
        threadId: null,
        threadName: "Planning lane",
      }],
    };
    const splitPlan: PlannedRoutingPlan = {
      items: [
        {
          id: "opening",
          source: "Unclear opening. ",
          kind: "developing_thought",
          action: null,
          due: null,
          ownerId: null,
          destinations: [],
          duplicateActionId: null,
          unresolved: true,
          ambiguity: "No destination is declared safely.",
        },
        {
          id: "atomic",
          source: "Capture routing stays atomic",
          kind: "developing_thought",
          action: null,
          due: null,
          ownerId: null,
          destinations: [{ type: "existing", threadId: "capture" }],
          duplicateActionId: null,
          unresolved: false,
          ambiguity: null,
        },
        {
          id: "atomic-context",
          source: " because retries happen. ",
          kind: "supporting_context",
          action: null,
          due: null,
          ownerId: "atomic",
          destinations: [],
          duplicateActionId: null,
          unresolved: false,
          ambiguity: null,
        },
        {
          id: "planning",
          source: "A new planning lane needs its own home. ",
          kind: "developing_thought",
          action: null,
          due: null,
          ownerId: null,
          destinations: [{ type: "new", newThreadKey: "planning" }],
          duplicateActionId: null,
          unresolved: false,
          ambiguity: null,
        },
        {
          id: "ending",
          source: "Unclear ending.",
          kind: "developing_thought",
          action: null,
          due: null,
          ownerId: null,
          destinations: [],
          duplicateActionId: null,
          unresolved: true,
          ambiguity: "No destination is declared safely.",
        },
      ],
      newThreads: [{
        key: "planning",
        name: "Planning lane",
        closestExistingThreadId: "capture",
        whyNew: "The plan declares this as a separate bounded subject.",
      }],
    };

    const result = settlePlannedRouting(splitBoard, {
      captureId: "split-capture",
      plan: splitPlan,
      recovery: splitRecovery,
      now,
    });
    expect(result.status).toBe("applied");
    if (result.status !== "applied") return;
    expect(result.board.actions.filter((action) => action.unsorted).map((action) => action.src))
      .toEqual(["Unclear opening. ", "Unclear ending."]);
    expect(result.board.actions.filter((action) => action.unsorted).map((action) => action.imgs))
      .toEqual([["split-photo"], []]);
    expect(result.board.threads.find((thread) => thread.id === "capture")?.frags.at(-1)?.text)
      .toBe("Capture routing stays atomic because retries happen. ");
    expect(result.board.threads.find((thread) => thread.name === "Planning lane")?.frags.at(-1)?.text)
      .toBe("A new planning lane needs its own home. ");
    expect(result.summaryThreadIds).toHaveLength(2);
  });

  it("records a duplicate-only Action as one no-op settlement", () => {
    const duplicateRaw = "Draft the two alternative labels.";
    const existing: Action = {
      id: "existing-labels",
      text: "Draft two alternative labels",
      done: false,
      at: at - 1,
      shelf: "keep",
      expires: null,
    };
    const duplicateWaiting = { ...waiting, id: "duplicate-waiting", text: duplicateRaw, src: duplicateRaw, imgs: [] };
    const duplicateBoard = board({
      actions: [duplicateWaiting, existing],
      ledger: [{
        id: "duplicate-pending",
        captureId: "duplicate-capture",
        at,
        raw: duplicateRaw,
        clean: duplicateRaw,
        kind: "pending",
        source: "typed",
        targetId: duplicateWaiting.id,
      }],
    });
    const duplicateRecovery: SortResult = {
      clean: duplicateRaw,
      kind: "action",
      title: "Draft labels",
      actions: ["Draft two alternative labels"],
      primaryActions: [],
      shelfLife: "keep",
      due: null,
      threadId: null,
      threadName: null,
      primaryText: null,
      also: [],
    };
    const duplicatePlan: PlannedRoutingPlan = {
      items: [{
        id: "duplicate-action",
        source: duplicateRaw,
        kind: "action",
        action: "Draft two alternative labels",
        due: null,
        ownerId: null,
        destinations: [],
        duplicateActionId: existing.id,
        unresolved: false,
        ambiguity: null,
      }],
      newThreads: [],
    };

    const once = settlePlannedRouting(duplicateBoard, {
      captureId: "duplicate-capture",
      plan: duplicatePlan,
      recovery: duplicateRecovery,
      now,
    });
    expect(once.status).toBe("applied");
    if (once.status !== "applied") return;
    expect(once.board.actions).toEqual([existing]);
    expect(once.board.ledger.find((entry) => entry.kind === "action" && !entry.undone))
      .toMatchObject({ captureId: "duplicate-capture", targetId: existing.id });

    const retry = settlePlannedRouting(hydrate(JSON.parse(JSON.stringify(once.board))), {
      captureId: "duplicate-capture",
      plan: duplicatePlan,
      recovery: duplicateRecovery,
      now: now + 1,
    });
    expect(retry).toMatchObject({ status: "conflict", reason: "already_settled" });
    expect(retry.board.actions).toHaveLength(1);
  });

  it("keeps an all-unresolved plan pending and still marks that exact plan application idempotently", () => {
    const unresolvedRaw = "This thought has no safe declared home.";
    const unresolvedWaiting = {
      ...waiting,
      id: "unresolved-waiting",
      text: unresolvedRaw,
      src: unresolvedRaw,
      imgs: ["unresolved-photo"],
    };
    const unresolvedBoard = board({
      actions: [unresolvedWaiting],
      ledger: [{
        id: "unresolved-pending",
        captureId: "unresolved-capture",
        at,
        raw: unresolvedRaw,
        clean: unresolvedRaw,
        kind: "pending",
        source: "dictated",
        transcript: "This thought has no safe declared home.",
        targetId: unresolvedWaiting.id,
        imgs: ["unresolved-photo"],
      }],
    });
    const unresolvedRecovery: SortResult = {
      clean: unresolvedRaw,
      kind: "thread",
      title: "Unclear thought",
      actions: [],
      primaryActions: [],
      shelfLife: "keep",
      due: null,
      threadId: "capture",
      threadName: null,
      primaryText: null,
      also: [],
    };
    const unresolvedPlan: PlannedRoutingPlan = {
      items: [{
        id: "\ud800",
        source: unresolvedRaw,
        kind: "developing_thought",
        action: null,
        due: null,
        ownerId: null,
        destinations: [],
        duplicateActionId: null,
        unresolved: true,
        ambiguity: "The plan cannot choose a destination from the source.",
      }],
      newThreads: [],
    };

    const once = settlePlannedRouting(unresolvedBoard, {
      captureId: "unresolved-capture",
      plan: unresolvedPlan,
      recovery: unresolvedRecovery,
      now,
    });
    expect(once.status).toBe("applied");
    if (once.status !== "applied") return;
    expect(once.board.actions).toEqual([
      expect.objectContaining({
        text: unresolvedRaw,
        src: unresolvedRaw,
        unsorted: true,
        imgs: ["unresolved-photo"],
      }),
    ]);
    expect(once.board.ledger.filter((entry) => !entry.undone).map((entry) => entry.kind))
      .toEqual(["pending"]);

    const retry = settlePlannedRouting(hydrate(JSON.parse(JSON.stringify(once.board))), {
      captureId: "unresolved-capture",
      plan: unresolvedPlan,
      recovery: unresolvedRecovery,
      now: now + 1,
    });
    expect(retry).toMatchObject({ status: "conflict", reason: "already_settled" });
  });

  it("returns the original board on validation, capture-authority, and current-state conflicts", () => {
    const invalidPlan: PlannedRoutingPlan = {
      ...plan,
      items: plan.items.slice(0, -1),
    };
    const original = board();
    const invalid = settlePlannedRouting(original, {
      captureId,
      plan: invalidPlan,
      recovery,
      now,
    });
    expect(invalid).toMatchObject({ status: "conflict", reason: "invalid_plan" });
    expect(invalid.board).toBe(original);

    const wrongIdentity = settlePlannedRouting(original, {
      captureId: "another-capture",
      plan,
      recovery,
      now,
    });
    expect(wrongIdentity).toMatchObject({ status: "conflict", reason: "not_pending" });
    expect(wrongIdentity.board).toBe(original);

    const edited = board({ actions: [{ ...waiting, text: "A concurrent edit", src: "A concurrent edit" }] });
    const stale = settlePlannedRouting(edited, { captureId, plan, recovery, now });
    expect(stale).toMatchObject({ status: "conflict", reason: "pending_mismatch" });
    expect(stale.board).toBe(edited);

    const sameTextNewRevision = board({
      actions: [{ ...waiting, pendingRevision: 2 }],
      ledger: board().ledger.map((entry) => ({ ...entry, pendingRevision: 2 })),
    });
    const staleRevision = settlePlannedRouting(sameTextNewRevision, {
      captureId,
      revision: 1,
      plan,
      recovery,
      now,
    });
    expect(staleRevision).toMatchObject({ status: "conflict", reason: "pending_mismatch" });
    expect(staleRevision.board).toBe(sameTextNewRevision);

    const alreadySettled = board({
      ledger: [
        ...board().ledger,
        {
          id: "manual-settlement",
          captureId,
          at: now,
          raw,
          clean: raw,
          kind: "action",
          source: "typed",
          targetId: "manual-action",
        },
      ],
    });
    const late = settlePlannedRouting(alreadySettled, { captureId, plan, recovery, now });
    expect(late).toMatchObject({ status: "conflict", reason: "already_settled" });
    expect(late.board).toBe(alreadySettled);

    const ledgerCollision = board({
      ledger: [
        ...board().ledger,
        {
          id: "planned:capture-p2:ledger-thread:retake-thought~003a~retake",
          captureId: "another-capture",
          at: now,
          raw: "Unrelated history",
          clean: "Unrelated history",
          kind: "thread",
          source: "typed",
          targetId: "retake",
        },
      ],
    });
    const collision = settlePlannedRouting(ledgerCollision, { captureId, plan, recovery, now });
    expect(collision).toMatchObject({ status: "conflict", reason: "identity_collision" });
    expect(collision.board).toBe(ledgerCollision);
  });
});
