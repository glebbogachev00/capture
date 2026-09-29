import { describe, expect, it } from "vitest";
import { referencedImageIds } from "./imgSync";
import { EMPTY, hydrate, type Action, type Board } from "./model";
import {
  settleManualSplitForAction,
  validateManualSplitDraft,
  type ManualSplitSegment,
} from "./manualSplitSettlement";
import type { ManualPendingSnapshot } from "./manualRoutingSettlement";
import { mergeSync } from "./sync";

const at = new Date("2026-09-28T09:00:00+07:00").getTime();
const now = at + 60_000;
const captureId = "split-capture";
const source = "First exact part.\nSecond repeated part.\nFirst exact part.";
const shown: Action = {
  id: "original-envelope",
  text: source,
  src: source,
  done: false,
  at,
  updatedAt: at,
  imgs: ["photo-one", "photo-two"],
  shelf: "keep",
  expires: null,
  unsorted: true,
  pendingRevision: 3,
};
const snapshot: ManualPendingSnapshot = {
  ...shown,
  pendingId: "original-pending",
  captureId,
  targetId: shown.id,
  source,
  imageIds: [...shown.imgs!],
  revision: 3,
  inputSource: "dictated",
};

const board = (over: Partial<Board> = {}): Board => ({
  ...EMPTY,
  principles: [],
  actions: [shown],
  threads: [{ id: "existing", name: "Existing", summary: "", frags: [] }],
  ledger: [{
    id: "original-pending",
    captureId,
    at,
    raw: "First exact part.\nSecond repeated part.\nFirst exact part.",
    transcript: "First exact part, second repeated part, first exact part",
    clean: source,
    kind: "pending",
    partial: true,
    pendingRevision: 3,
    pendingSource: source,
    source: "dictated",
    targetId: shown.id,
    imgs: ["photo-one", "photo-two"],
  }],
  ...over,
});

const segments = (over: Partial<ManualSplitSegment>[] = []): ManualSplitSegment[] => [
  {
    id: "first",
    sourceOrder: 0,
    text: "First exact part.\n",
    destination: { kind: "action" },
    ...over[0],
  },
  {
    id: "second",
    sourceOrder: 1,
    text: "Second repeated part.\n",
    destination: { kind: "thread", threadId: "existing" },
    ...over[1],
  },
  {
    id: "third",
    sourceOrder: 2,
    text: "First exact part.",
    destination: { kind: "pending" },
    ...over[2],
  },
];

describe("manual split validation", () => {
  it("accepts exact source coverage independent of explicit filing order", () => {
    const reordered = [segments()[2], segments()[0], segments()[1]];
    expect(validateManualSplitDraft(source, reordered)).toEqual([]);
  });

  it.each([
    ["lost text", segments([{ text: "First part.\n" }]), "source_mismatch"],
    ["invented text", segments([{}, {}, { text: "First exact part.!" }]), "source_mismatch"],
    ["one segment", [segments()[0]], "too_few_segments"],
    ["empty segment", [...segments(), { ...segments()[0], id: "empty", sourceOrder: 4, text: "" }], "empty_segment"],
    ["duplicate id", segments([{}, { id: "first" }]), "duplicate_identity"],
    ["duplicate source order", segments([{}, { sourceOrder: 0 }]), "duplicate_identity"],
    ["missing destination", segments([{}, { destination: { kind: "thread", threadId: "" } }]), "missing_destination"],
  ])("rejects %s mechanically", (_case, candidate, failure) => {
    expect(validateManualSplitDraft(source, candidate as ManualSplitSegment[])).toContain(failure);
  });
});

describe("authoritative manual split settlement", () => {
  it("atomically applies explicit destinations with exact provenance and leaves text pending", () => {
    const result = settleManualSplitForAction(board(), snapshot, segments(), now);

    expect(result.status).toBe("applied");
    if (result.status !== "applied") return;
    const action = result.board.actions.find((item) => !item.unsorted)!;
    expect(action).toMatchObject({ text: segments()[0].text, src: segments()[0].text, shelf: "keep" });
    const existing = result.board.threads.find((thread) => thread.id === "existing")!;
    expect(existing.frags).toEqual([expect.objectContaining({ text: segments()[1].text, imgs: [] })]);
    const pending = result.board.actions.find((item) => item.src === segments()[2].text)!;
    expect(pending).toMatchObject({ unsorted: true, pendingRevision: 4, imgs: [] });

    const activeRows = result.board.ledger.filter((entry) =>
      entry.captureId === captureId && !entry.undone && entry.targetId !== shown.id
    );
    expect(activeRows).toHaveLength(3);
    expect(activeRows.map((entry) => entry.clean)).toEqual(expect.arrayContaining(segments().map((segment) => segment.text)));
    expect(activeRows).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "action", settledBy: "manual", raw: source, transcript: expect.any(String) }),
      expect.objectContaining({ kind: "thread", settledBy: "manual", targetId: "existing" }),
      expect.objectContaining({ kind: "pending", partial: true, pendingRevision: 4 }),
    ]));
    expect(result.board.ledger.find((entry) => entry.id === "original-pending"))
      .toMatchObject({ undone: true, imgs: undefined });
  });

  it("uses visible segment order for artifact order without changing canonical source coverage", () => {
    const candidate = segments([
      { destination: { kind: "action" } },
      { destination: { kind: "action" } },
      { destination: { kind: "action" } },
    ]);
    const reordered = [candidate[2], candidate[0], candidate[1]];
    const result = settleManualSplitForAction(board({
      actions: [{ ...shown, imgs: [] }],
      ledger: board().ledger.map((entry) => ({ ...entry, imgs: undefined })),
    }), { ...snapshot, imgs: [], imageIds: [] }, reordered, now);

    expect(result.status).toBe("applied");
    if (result.status !== "applied") return;
    expect(result.board.actions.map((action) => action.text)).toEqual(reordered.map((segment) => segment.text));
  });

  it("creates original-wording Intentions and mechanically titled new Threads", () => {
    const candidate = segments([
      { destination: { kind: "intention" } },
      { destination: { kind: "thread", threadId: null } },
    ]).slice(0, 2);
    candidate[1].text += segments()[2].text;
    const result = settleManualSplitForAction(board({
      actions: [{ ...shown, imgs: [] }],
      ledger: board().ledger.map((entry) => ({ ...entry, imgs: undefined })),
    }), { ...snapshot, imgs: [], imageIds: [] }, candidate, now);

    expect(result.status).toBe("applied");
    if (result.status !== "applied") return;
    expect(result.board.intentions[0]).toMatchObject({
      rawInput: candidate[0].text,
      expandedIntention: candidate[0].text,
      recommendedActions: [],
      counterIntentions: [],
      imgs: [],
    });
    const created = result.board.threads.find((thread) => thread.id !== "existing")!;
    expect(created).toMatchObject({ temporaryName: true, summary: "" });
    expect(created.frags).toEqual([expect.objectContaining({ text: candidate[1].text, imgs: [] })]);
  });

  it("keeps all attachments exactly once on the original image-only pending envelope", () => {
    const candidate = segments([
      { destination: { kind: "action" } },
      { destination: { kind: "intention" } },
      { destination: { kind: "thread", threadId: "existing" } },
    ]);
    const result = settleManualSplitForAction(board(), snapshot, candidate, now);

    expect(result.status).toBe("applied");
    if (result.status !== "applied") return;
    const attachmentOwner = result.board.actions.find((action) => action.id === shown.id)!;
    expect(attachmentOwner).toMatchObject({
      text: "",
      src: "",
      unsorted: true,
      pendingRevision: 4,
      imgs: ["photo-one", "photo-two"],
    });
    expect(result.board.ledger.find((entry) => !entry.undone && entry.targetId === shown.id))
      .toMatchObject({
        captureId,
        raw: source,
        clean: "",
        pendingSource: "",
        partial: true,
        imgs: ["photo-one", "photo-two"],
      });
    expect(result.tombstones).toEqual([]);
    expect(referencedImageIds(result.board).sort()).toEqual(["photo-one", "photo-two"]);
    expect(result.board.actions.filter((action) => action.id !== shown.id).flatMap((action) => action.imgs ?? []))
      .toEqual([]);
    expect(result.board.intentions.flatMap((intention) => intention.imgs ?? [])).toEqual([]);
    expect(result.board.threads.flatMap((thread) => thread.frags.flatMap((frag) => frag.imgs ?? [])))
      .toEqual([]);
  });

  it("retires an image-free original with one tombstone", () => {
    const sourceBoard = board({
      actions: [{ ...shown, imgs: [] }],
      ledger: board().ledger.map((entry) => ({ ...entry, imgs: undefined })),
    });
    const result = settleManualSplitForAction(sourceBoard, { ...snapshot, imgs: [], imageIds: [] }, segments(), now);
    expect(result.status).toBe("applied");
    if (result.status !== "applied") return;
    expect(result.board.actions.some((action) => action.id === shown.id)).toBe(false);
    expect(result.tombstones).toEqual([{ kind: "action", id: shown.id, deletedAt: now }]);
  });

  it("survives JSON reload and stale-device sync without duplicating text or images", () => {
    const settled = settleManualSplitForAction(board(), snapshot, segments(), now);
    expect(settled.status).toBe("applied");
    if (settled.status !== "applied") return;
    const reloaded = hydrate(JSON.parse(JSON.stringify(settled.board)));
    const synced = mergeSync(
      { board: reloaded, tombstones: settled.tombstones },
      { board: board(), tombstones: [] },
      now + 1,
    );
    const active = synced.board.ledger.filter((entry) => entry.captureId === captureId && !entry.undone);
    expect(active.filter((entry) => entry.clean === segments()[0].text)).toHaveLength(1);
    expect(active.filter((entry) => entry.clean === segments()[1].text)).toHaveLength(1);
    expect(active.filter((entry) => entry.clean === segments()[2].text)).toHaveLength(1);
    expect(active.filter((entry) => entry.targetId === shown.id && entry.kind === "pending")).toHaveLength(1);
    expect(referencedImageIds(synced.board).sort()).toEqual(["photo-one", "photo-two"]);
  });

  it.each([
    ["stale shown source", { ...snapshot, src: "edited", text: "edited", source: "edited" }, segments(), "pending_mismatch"],
    ["invalid coverage", snapshot, segments([{ text: "lost" }]), "invalid_split"],
    ["stale destination", snapshot, segments([{}, { destination: { kind: "thread", threadId: "missing" } }]), "stale_destination"],
  ])("refuses %s without changing the board", (_case, candidateShown, candidateSegments, reason) => {
    const current = board();
    const result = settleManualSplitForAction(current, candidateShown, candidateSegments, now);
    expect(result).toMatchObject({ status: "conflict", reason });
    expect(result.board).toBe(current);
  });

  it("is idempotent on repeated save", () => {
    const first = settleManualSplitForAction(board(), snapshot, segments(), now);
    expect(first.status).toBe("applied");
    if (first.status !== "applied") return;
    const repeated = settleManualSplitForAction(first.board, snapshot, segments(), now + 1);
    expect(repeated).toMatchObject({ status: "conflict", reason: "pending_mismatch" });
    expect(repeated.board).toBe(first.board);
    expect(first.board.ledger.filter((entry) => entry.captureId === captureId && !entry.undone))
      .toHaveLength(4);
  });

  it.each([
    ["changed attachments", ["photo-one", "photo-three"]],
    ["reordered attachments", ["photo-two", "photo-one"]],
  ])("rejects %s even when id, source, and revision still match", (_case, imageIds) => {
    const changed = board({
      actions: [{ ...shown, imgs: imageIds }],
      ledger: board().ledger.map((entry) => ({ ...entry, imgs: imageIds })),
    });
    const result = settleManualSplitForAction(changed, snapshot, segments(), now);
    expect(result).toMatchObject({ status: "conflict", reason: "pending_mismatch" });
    expect(result.board).toBe(changed);
  });

  it.each([
    ["different capture identity", { captureId: "replacement-capture" }],
    ["stale pending-row identity", { id: "replacement-pending" }],
  ])("rejects a %s from the editor snapshot", (_case, rowChange) => {
    const changed = board({
      ledger: board().ledger.map((entry) => ({ ...entry, ...rowChange })),
    });
    const result = settleManualSplitForAction(changed, snapshot, segments(), now);
    expect(result).toMatchObject({ status: "conflict", reason: "pending_mismatch" });
    expect(result.board).toBe(changed);
  });

  it("rejects duplicate active pending rows targeting the shown envelope", () => {
    const duplicate = board({
      ledger: [
        ...board().ledger,
        { ...board().ledger[0], id: "duplicate-pending" },
      ],
    });
    const result = settleManualSplitForAction(duplicate, snapshot, segments(), now);
    expect(result).toMatchObject({ status: "conflict", reason: "pending_mismatch" });
    expect(result.board).toBe(duplicate);
  });

  it("rejects a stale non-partial pending row after classified settlement", () => {
    const stale = board({
      ledger: [
        { ...board().ledger[0], partial: undefined },
        {
          id: "earlier-settlement", captureId, at, raw: source, clean: "Earlier output",
          kind: "action", source: "dictated", targetId: "earlier-action", settledBy: "automatic",
        },
      ],
    });
    const result = settleManualSplitForAction(stale, snapshot, segments(), now);
    expect(result).toMatchObject({ status: "conflict", reason: "already_settled" });
    expect(result.board).toBe(stale);
  });

  it("settles only the selected row when two discontiguous partial rows remain", () => {
    const siblingSource = "Sibling remainder";
    const sibling: Action = {
      ...shown,
      id: "sibling-envelope",
      text: siblingSource,
      src: siblingSource,
      imgs: [],
    };
    const multi = board({
      actions: [shown, sibling, {
        id: "earlier-action", text: "Earlier output", done: false, at, shelf: "keep", expires: null,
      }],
      ledger: [
        ...board().ledger,
        {
          id: "earlier-settlement", captureId, at, raw: source, clean: "Earlier output",
          kind: "action", source: "dictated", targetId: "earlier-action", settledBy: "automatic",
        },
        {
          id: "sibling-pending", captureId, at, raw: source, clean: siblingSource,
          kind: "pending", partial: true, pendingRevision: 3, pendingSource: siblingSource,
          source: "dictated", targetId: sibling.id,
        },
      ],
    });
    const result = settleManualSplitForAction(multi, snapshot, segments(), now);
    expect(result.status).toBe("applied");
    if (result.status !== "applied") return;
    expect(result.board.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "sibling-envelope", unsorted: true }),
      expect.objectContaining({ id: "earlier-action" }),
    ]));
    expect(result.board.ledger.find((entry) => entry.id === "sibling-pending")?.undone).not.toBe(true);
    expect(result.board.ledger.find((entry) => entry.id === "earlier-settlement")?.undone).not.toBe(true);
  });
});
