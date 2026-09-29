import { describe, expect, it } from "vitest";
import { applyActionDone } from "./actionOps";
import { buildBackup } from "./backup";
import { referencedImageIds } from "./imgSync";
import { EMPTY, hydrate, type Action, type Board } from "./model";
import {
  settleManualRouting,
  settleManualRoutingForAction,
  snapshotManualPending,
} from "./manualRoutingSettlement";
import { mergeSync } from "./sync";

const at = new Date("2026-09-27T09:00:00+07:00").getTime();
const now = at + 60_000;
const captureId = "manual-capture";
const raw = "Keep my exact original wording";

const waiting: Action = {
  id: "waiting-manual",
  text: raw,
  src: raw,
  done: false,
  at,
  updatedAt: at,
  imgs: ["photo-one"],
  shelf: "keep",
  expires: null,
  unsorted: true,
  pendingRevision: 1,
};

const board = (over: Partial<Board> = {}): Board => ({
  ...EMPTY,
  principles: [],
  actions: [waiting],
  threads: [{ id: "existing-thread", name: "Existing thread", summary: "Earlier context", frags: [] }],
  ledger: [{
    id: "pending-ledger",
    captureId,
    at,
    raw,
    transcript: "Keep, um, my exact original wording",
    clean: raw,
    kind: "pending",
    pendingRevision: 1,
    pendingSource: raw,
    source: "dictated",
    targetId: waiting.id,
    imgs: ["photo-one"],
  }],
  ...over,
});

describe("authoritative manual routing settlement", () => {
  it("files the exact pending revision as one Action with the existing default shelf policy", () => {
    const result = settleManualRouting(board(), {
      captureId,
      revision: 1,
      destination: { kind: "action" },
      now,
    });

    expect(result.status).toBe("applied");
    if (result.status !== "applied") return;
    expect(result.board.actions).toEqual([
      expect.objectContaining({
        id: result.target.id,
        text: raw,
        src: raw,
        at,
        imgs: [],
        shot: expect.objectContaining({
          threadId: expect.any(String),
          fragId: expect.any(String),
        }),
        shelf: "keep",
        expires: null,
      }),
    ]);
    expect(result.board.actions[0]).not.toHaveProperty("unsorted");
    const owner = result.board.threads.find((thread) =>
      thread.id === result.board.actions[0].shot?.threadId
    );
    expect(owner).toMatchObject({
      temporaryName: true,
      frags: [expect.objectContaining({
        id: result.board.actions[0].shot?.fragId,
        text: raw,
        imgs: ["photo-one"],
      })],
    });
    expect(result.board.ledger.find((entry) => entry.id === "pending-ledger"))
      .toMatchObject({ undone: true, imgs: undefined });
    expect(result.board.ledger.find((entry) => entry.id === result.ledgerId))
      .toMatchObject({
        captureId,
        at,
        raw,
        transcript: "Keep, um, my exact original wording",
        clean: raw,
        kind: "action",
        source: "dictated",
        targetId: result.target.id,
        imgs: ["photo-one"],
        settledBy: "manual",
      });
    expect(result.tombstones).toEqual([{ kind: "action", id: waiting.id, deletedAt: now }]);
  });

  it("keeps multiple manually filed Action images rendered through completion, reload, sync, ledger, and backup", () => {
    const imageIds = ["photo-one", "photo-two"];
    const pendingBoard = board({
      actions: [{ ...waiting, imgs: imageIds }],
      ledger: board().ledger.map((entry) => ({ ...entry, imgs: imageIds })),
    });
    const settled = settleManualRouting(pendingBoard, {
      captureId,
      revision: 1,
      destination: { kind: "action" },
      now,
    });
    expect(settled.status).toBe("applied");
    if (settled.status !== "applied" || settled.target.kind !== "action") return;

    const action = settled.board.actions.find((candidate) => candidate.id === settled.target.id)!;
    const owner = settled.board.threads.find((thread) => thread.id === action.shot?.threadId)!;
    expect(action.imgs).toEqual([]);
    expect(owner.frags.find((frag) => frag.id === action.shot?.fragId)?.imgs).toEqual(imageIds);
    expect(settled.board.ledger.find((entry) => entry.id === settled.ledgerId))
      .toMatchObject({ settledBy: "manual", targetId: action.id, imgs: imageIds });

    const completed = applyActionDone(settled.board, action.id, now + 1)!;
    expect(completed.imgs).toEqual([]);
    expect(completed.board.actions).toHaveLength(0);
    expect(completed.board.threads.find((thread) => thread.id === owner.id)?.frags[0].imgs)
      .toEqual(imageIds);
    expect(referencedImageIds(completed.board).sort()).toEqual([...imageIds].sort());

    const reloaded = hydrate(JSON.parse(JSON.stringify(completed.board)));
    expect(reloaded.threads.find((thread) => thread.id === owner.id)?.frags[0].imgs)
      .toEqual(imageIds);
    const synced = mergeSync(
      { board: reloaded, tombstones: settled.tombstones },
      { board: pendingBoard, tombstones: [] },
      now + 2,
    );
    expect(synced.board.actions.some((candidate) => candidate.id === waiting.id)).toBe(false);
    expect(synced.board.threads.find((thread) => thread.id === owner.id)?.frags[0].imgs)
      .toEqual(imageIds);
    expect(referencedImageIds(synced.board).sort()).toEqual([...imageIds].sort());

    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=";
    const backup = buildBackup(synced.board, {
      "photo-one": png,
      "photo-two": png,
    });
    expect(Object.keys(backup.images).sort()).toEqual([...imageIds].sort());
  });

  it("files an Intention in original wording with no generated guidance", () => {
    const result = settleManualRouting(board(), {
      captureId,
      revision: 1,
      destination: { kind: "intention" },
      now,
    });

    expect(result.status).toBe("applied");
    if (result.status !== "applied") return;
    expect(result.target.kind).toBe("intention");
    expect(result.board.intentions).toEqual([
      expect.objectContaining({
        id: result.target.id,
        rawInput: raw,
        expandedIntention: raw,
        recommendedActions: [],
        counterIntentions: [],
        imgs: ["photo-one"],
        at,
        updatedAt: now,
      }),
    ]);
    expect(result.board.actions).toHaveLength(0);
    expect(result.board.ledger.find((entry) => entry.id === result.ledgerId))
      .toMatchObject({ kind: "intention", settledBy: "manual", targetId: result.target.id });
  });

  it("adds one exact fragment to a selected existing Thread", () => {
    const result = settleManualRouting(board(), {
      captureId,
      revision: 1,
      destination: { kind: "thread", threadId: "existing-thread" },
      now,
    });

    expect(result.status).toBe("applied");
    if (result.status !== "applied") return;
    expect(result.target).toMatchObject({ kind: "thread", id: "existing-thread" });
    expect(result.board.threads[0].frags).toEqual([
      expect.objectContaining({ text: raw, imgs: ["photo-one"], at, updatedAt: now }),
    ]);
    expect(result.board.ledger.find((entry) => entry.id === result.ledgerId))
      .toMatchObject({
        kind: "thread",
        settledBy: "manual",
        targetId: "existing-thread",
        targetFragId: result.target.kind === "thread" ? result.target.fragId : undefined,
      });
  });

  it("creates an offline-safe Thread with a clearly temporary mechanical title", () => {
    const source = "Plan the Capture release without asking a model";
    const sourceBoard = board({
      actions: [{ ...waiting, text: source, src: source }],
      ledger: board().ledger.map((entry) => ({ ...entry, raw: source, clean: source, pendingSource: source })),
    });
    const result = settleManualRouting(sourceBoard, {
      captureId,
      revision: 1,
      destination: { kind: "thread", threadId: null },
      now,
    });

    expect(result.status).toBe("applied");
    if (result.status !== "applied" || result.target.kind !== "thread") return;
    const created = result.board.threads.find((thread) => thread.id === result.target.id)!;
    expect(created.name).toBe("Temporary — Plan the Capture release without");
    expect(created.temporaryName).toBe(true);
    expect(created.summary).toBe("");
    expect(created).not.toHaveProperty("belongs");
    expect(created.frags).toEqual([
      expect.objectContaining({ text: source, imgs: ["photo-one"] }),
    ]);
  });

  it("uses the person's bounded picker name while keeping the Thread semantically isolated", () => {
    const result = settleManualRouting(board(), {
      captureId,
      revision: 1,
      destination: {
        kind: "thread",
        threadId: null,
        threadName: `  ${"Named subject ".repeat(12)}  `,
      },
      now,
    });

    expect(result.status).toBe("applied");
    if (result.status !== "applied" || result.target.kind !== "thread") return;
    const created = result.board.threads.find((thread) => thread.id === result.target.id)!;
    expect(created.name.startsWith("Named subject")).toBe(true);
    expect(created.name.length).toBeLessThanOrEqual(100);
    expect(created.temporaryName).toBe(true);
    expect(created.summary).toBe("");
    expect(created).not.toHaveProperty("belongs");
  });

  it.each([
    ["edited revision", board({
      actions: [{ ...waiting, text: "edited", src: "edited", pendingRevision: 2 }],
      ledger: board().ledger.map((entry) => ({
        ...entry,
        clean: "edited",
        pendingSource: "edited",
        pendingRevision: 2,
      })),
    }), { kind: "action" } as const, "pending_mismatch"],
    ["deleted envelope", board({ actions: [], ledger: board().ledger.map((entry) => ({ ...entry, undone: true })) }),
      { kind: "action" } as const, "not_pending"],
    ["stale Thread", board(), { kind: "thread", threadId: "missing-thread" } as const, "stale_destination"],
  ])("refuses a %s without changing the board", (_case, candidate, destination, reason) => {
    const result = settleManualRouting(candidate, { captureId, revision: 1, destination, now });
    expect(result).toMatchObject({ status: "conflict", reason });
    expect(result.board).toBe(candidate);
  });

  it("files only a partial unresolved pending revision after earlier resolved outputs", () => {
    const remainder = "The final home of this aside is unclear.";
    const partialEnvelope: Action = {
      ...waiting,
      id: "partial-remainder",
      text: remainder,
      src: remainder,
      pendingRevision: 2,
    };
    const partialBoard = board({
      actions: [
        {
          id: "planned-earlier-action",
          text: "Draft the labels",
          done: false,
          at,
          updatedAt: now - 10,
          shelf: "keep",
          expires: null,
        },
        partialEnvelope,
      ],
      ledger: [
        {
          id: "planned:manual-capture:settlement",
          captureId,
          at,
          raw,
          clean: "Draft the labels",
          kind: "action",
          source: "typed",
          targetId: "planned-earlier-action",
          settledBy: "automatic",
        },
        {
          id: "planned:manual-capture:ledger-pending:remainder",
          captureId,
          at,
          raw: remainder,
          clean: remainder,
          kind: "pending",
          partial: true,
          pendingRevision: 2,
          pendingSource: remainder,
          source: "typed",
          targetId: partialEnvelope.id,
          imgs: ["photo-one"],
        },
      ],
    });

    const result = settleManualRouting(partialBoard, {
      captureId,
      revision: 2,
      destination: { kind: "thread", threadId: "existing-thread" },
      now,
    });

    expect(result.status).toBe("applied");
    if (result.status !== "applied") return;
    expect(result.board.actions).toEqual([
      expect.objectContaining({ id: "planned-earlier-action", text: "Draft the labels" }),
    ]);
    expect(result.board.threads[0].frags).toEqual([
      expect.objectContaining({ text: remainder, imgs: ["photo-one"] }),
    ]);
    expect(result.board.ledger.filter((entry) =>
      entry.captureId === captureId && entry.kind === "action" && !entry.undone
    )).toHaveLength(1);
    expect(result.board.ledger.filter((entry) =>
      entry.captureId === captureId && entry.kind === "thread" && !entry.undone
    )).toEqual([expect.objectContaining({ clean: remainder, settledBy: "manual" })]);
    expect(result.board.ledger.find((entry) => entry.id === "planned:manual-capture:ledger-pending:remainder"))
      .toMatchObject({ undone: true });
  });

  it("settles only the exact shown row when one capture has discontiguous sibling remainders", () => {
    const first: Action = {
      ...waiting,
      id: "remainder-one",
      text: "First unresolved run",
      src: "First unresolved run",
      imgs: [],
      pendingRevision: 2,
    };
    const second: Action = {
      ...waiting,
      id: "remainder-two",
      text: "Second unresolved run",
      src: "Second unresolved run",
      imgs: [],
      pendingRevision: 2,
    };
    const multi: Board = board({
      actions: [
        first,
        { id: "automatic-output", text: "Earlier understood action", done: false, at, shelf: "keep", expires: null },
        second,
      ],
      ledger: [
        {
          id: "pending-one", captureId, at, raw, clean: first.text, kind: "pending",
          partial: true, pendingRevision: 2, pendingSource: first.text, source: "typed",
          targetId: first.id,
        },
        {
          id: "automatic-row", captureId, at, raw, clean: "Earlier understood action",
          kind: "action", source: "typed", targetId: "automatic-output", settledBy: "automatic",
        },
        {
          id: "pending-two", captureId, at, raw, clean: second.text, kind: "pending",
          partial: true, pendingRevision: 2, pendingSource: second.text, source: "typed",
          targetId: second.id,
        },
      ],
    });

    const firstSnapshot = snapshotManualPending(multi.ledger, first)!;
    const settledFirst = settleManualRoutingForAction(multi, firstSnapshot, { kind: "action" }, now);
    expect(settledFirst?.status).toBe("applied");
    if (!settledFirst || settledFirst.status !== "applied") return;
    expect(settledFirst.board.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "automatic-output", text: "Earlier understood action" }),
      expect.objectContaining({ id: "remainder-two", text: "Second unresolved run", unsorted: true }),
      expect.objectContaining({ text: "First unresolved run" }),
    ]));
    expect(settledFirst.board.actions.find((action) => action.text === "First unresolved run")?.unsorted)
      .not.toBe(true);
    expect(settledFirst.board.ledger.find((entry) => entry.id === "pending-one"))
      .toMatchObject({ undone: true });
    const siblingPending = settledFirst.board.ledger.find((entry) => entry.id === "pending-two");
    expect(siblingPending).toMatchObject({ pendingSource: "Second unresolved run" });
    expect(siblingPending?.undone).not.toBe(true);

    const duplicate = settleManualRoutingForAction(
      settledFirst.board,
      firstSnapshot,
      { kind: "action" },
      now + 1,
    );
    expect(duplicate?.status).not.toBe("applied");

    const secondSnapshot = snapshotManualPending(settledFirst.board.ledger, second)!;
    const settledSecond = settleManualRoutingForAction(
      settledFirst.board,
      secondSnapshot,
      { kind: "thread", threadId: "existing-thread" },
      now + 2,
    );
    expect(settledSecond?.status).toBe("applied");
    if (!settledSecond || settledSecond.status !== "applied") return;
    expect(settledSecond.board.actions.find((action) => action.id === "automatic-output"))
      .toBeTruthy();
    expect(settledSecond.board.ledger.filter((entry) =>
      entry.captureId === captureId && entry.settledBy === "manual" && !entry.undone
    )).toHaveLength(2);
  });

  it("is permanently authoritative and cannot duplicate on a repeated click", () => {
    const first = settleManualRouting(board(), {
      captureId,
      revision: 1,
      destination: { kind: "action" },
      now,
    });
    expect(first.status).toBe("applied");
    if (first.status !== "applied") return;

    const repeated = settleManualRouting(first.board, {
      captureId,
      revision: 1,
      destination: { kind: "action" },
      now: now + 1,
    });
    expect(repeated).toMatchObject({ status: "conflict", reason: "already_settled" });
    expect(repeated.board).toBe(first.board);
    expect(first.board.actions.filter((action) => action.text === raw)).toHaveLength(1);
  });
});
