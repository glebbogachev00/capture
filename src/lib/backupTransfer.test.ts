import { describe, expect, it, vi } from "vitest";
import { BACKUP_APP, type CaptureBackupV3 } from "./backup";
import {
  exportBackupV3,
  restoreBackupV3,
  type BackupAuthority,
} from "./backupTransfer";
import { EMPTY, type Board } from "./model";
import { mergeSync, type SyncState, type Tombstone } from "./sync";
import { shareRecord } from "./share";
import { dayKey } from "./record";
import { wrapRequest } from "./wrap";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=";
const GIF = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

function completeBoard(): Board {
  return {
    ...EMPTY,
    actions: [{
      id: "action", text: "Action", done: false, at: 10, updatedAt: 10,
      shelf: "keep", expires: null, imgs: ["action-image"], src: "Original action",
      unsorted: true,
    }],
    threads: [{
      id: "thread", name: "Thread", summary: "Summary", updatedAt: 20,
      cover: "img:cover-image", belongs: "Here", next: "Next",
      frags: [{ id: "frag", text: "Fragment", at: 21, updatedAt: 21, imgs: ["frag-image"] }],
    }],
    intentions: [{
      id: "intention", number: 1, rawInput: "Raw intention",
      expandedIntention: "Intention", recommendedActions: ["Practice"],
      counterIntentions: ["Avoid"], imgs: ["intention-image"], at: 30, updatedAt: 30,
    }],
    ledger: [{
      id: "record", captureId: "capture", at: 40, raw: "Pending words", clean: "Pending words",
      kind: "pending", source: "image", targetId: "action", imgs: ["record-image"],
    }],
    corrections: [{ id: "correction", at: 41, proposalKind: "undone", accepted: false, context: "Keep" }],
    wraps: [{
      day: "2026-09-20", at: 42, line: "Wrap", insights: [{ k: "signal", v: "Insight" }], tomorrow: "Tomorrow",
      stats: { day: "2026-09-20", said: 1, threadsMoved: 1, actionsMade: 1, intentions: 1,
        threads: [{ name: "Thread", n: 1 }], firstAt: 40, lastAt: 40, returns: [], finished: [] },
    }],
    completions: [{ id: "done", text: "Done", at: 43, threadId: "thread" }],
    historyEpoch: 7,
    historyImports: { import: "accepted" },
    profile: { name: "Owner", imageId: "profile-image", showSignature: true, updatedAt: 44 },
    futureField: { preserved: ["exactly"] },
  } as Board;
}

const tombstones: Tombstone[] = [
  { kind: "action", id: "deleted-action", deletedAt: Date.now() },
  { kind: "frag", id: "deleted-frag", deletedAt: Date.now() + 1 },
];

function localAuthority(): BackupAuthority {
  return { kind: "local", assertCurrent: vi.fn() };
}

function cloudAuthority(ownerId = "alice", verifyOwner = vi.fn(async () => ownerId)):
  BackupAuthority {
  return { kind: "cloud", ownerId, verifyOwner, assertCurrent: vi.fn() };
}

function v3(ownerId = "alice"): CaptureBackupV3 {
  const board = completeBoard();
  return {
    app: BACKUP_APP,
    version: 3,
    exportedAt: "2026-09-21T00:00:00.000Z",
    scope: { kind: "cloud", ownerId },
    complete: true,
    board,
    tombstones,
    images: Object.fromEntries([
      "action-image", "cover-image", "frag-image", "intention-image", "record-image", "profile-image",
    ].map((id, index) => [id, index % 2 ? GIF : PNG])),
  };
}

describe("backup v3 export", () => {
  it("round-trips every board field, tombstone and canonical image reference", async () => {
    const board = completeBoard();
    const ids = [
      "action-image", "cover-image", "frag-image", "intention-image", "record-image", "profile-image",
    ];
    const progress = vi.fn();
    const backup = await exportBackupV3({
      authority: localAuthority(),
      localState: { board, tombstones },
      readLocalImage: async (id) => ids.includes(id) ? PNG : null,
      onProgress: progress,
    });

    expect(backup).toMatchObject({
      app: BACKUP_APP, version: 3, scope: { kind: "local" }, complete: true,
      board, tombstones,
    });
    expect(Object.keys(backup.images).sort()).toEqual(ids.sort());
    expect(progress).toHaveBeenLastCalledWith({ phase: "ready", completed: 6, total: 6 });
  });

  it("exports the authoritative owner-bound Cloud state and fetches missing or corrupt local bytes remotely", async () => {
    const board = completeBoard();
    const remoteState = { board, tombstones };
    const localState = { ...remoteState, board: { ...board, actions: [] } };
    const readCloudState = vi.fn(async () => remoteState);
    const readLocalImage = vi.fn(async (id: string) =>
      id === "action-image" ? null : id === "cover-image" ? "data:image/png;base64,broken" : PNG);
    const readCloudImage = vi.fn(async (id: string) => id === "cover-image" ? GIF : PNG);

    const backup = await exportBackupV3({
      authority: cloudAuthority(), localState, readCloudState, readLocalImage, readCloudImage,
    });

    expect(backup.board).toEqual(board);
    expect(backup.scope).toEqual({ kind: "cloud", ownerId: "alice" });
    expect(backup.images["action-image"]).toBe(PNG);
    expect(backup.images["cover-image"]).toBe(GIF);
    expect(readCloudState).toHaveBeenCalledTimes(1);
    expect(readCloudImage.mock.calls.map(([id]) => id).sort()).toEqual(["action-image", "cover-image"]);
    expect(backup.board.actions[0]).toMatchObject({
      unsorted: true,
      src: "Original action",
      imgs: ["action-image"],
    });
    expect(backup.board.ledger[0]).toMatchObject({
      kind: "pending",
      raw: "Pending words",
      imgs: ["record-image"],
    });
    expect(shareRecord(backup.board).text).not.toContain("Pending words");
    expect(shareRecord(backup.board).text).not.toContain("Original action");
    expect(wrapRequest(backup.board, dayKey(40), [])).toBeNull();
  });

  it("refuses to label or return a complete backup when any referenced image is absent or corrupt", async () => {
    const download = vi.fn();
    await expect(exportBackupV3({
      authority: cloudAuthority(), localState: { board: EMPTY, tombstones: [] },
      readCloudState: async () => ({
        board: { ...EMPTY, profile: { name: "Owner", imageId: "missing" } }, tombstones: [],
      }),
      readLocalImage: async () => null,
      readCloudImage: async () => "data:image/png;base64,not-valid",
      onComplete: download,
    })).rejects.toThrow(/missing.*missing|missing.*corrupt|complete backup/i);
    expect(download).not.toHaveBeenCalled();
  });

  it("fails before reading Cloud data on owner mismatch and during an owner transition", async () => {
    const readCloudState = vi.fn(async () => ({ board: EMPTY, tombstones: [] }));
    await expect(exportBackupV3({
      authority: cloudAuthority("alice", vi.fn(async () => "bob")),
      localState: { board: EMPTY, tombstones: [] }, readCloudState,
      readLocalImage: async () => null, readCloudImage: async () => null,
    })).rejects.toThrow(/owner|account/i);
    expect(readCloudState).not.toHaveBeenCalled();

    let current = true;
    const authority: BackupAuthority = {
      kind: "cloud", ownerId: "alice", verifyOwner: async () => "alice",
      assertCurrent: () => { if (!current) throw new Error("Account changed during backup"); },
    };
    await expect(exportBackupV3({
      authority, localState: { board: EMPTY, tombstones: [] },
      readCloudState: async () => { current = false; return { board: EMPTY, tombstones: [] }; },
      readLocalImage: async () => null, readCloudImage: async () => null,
    })).rejects.toThrow(/account changed/i);
  });
});

describe("backup v3 restore", () => {
  it("restores a complete backup into a clean exact-owner Cloud account, uploads all media before PUT, verifies readback, then commits locally", async () => {
    const backup = v3();
    const events: string[] = [];
    let cloud: SyncState = { board: EMPTY, tombstones: [] };
    const commitLocal = vi.fn(async (state: SyncState, images: Record<string, string>) => {
      events.push("local");
      expect(state).toEqual(cloud);
      expect(images).toEqual(backup.images);
    });
    const result = await restoreBackupV3(backup, {
      authority: cloudAuthority(),
      currentState: { board: EMPTY, tombstones: [] },
      readCloudState: async () => { events.push("get"); return cloud; },
      uploadCloudImage: async (id) => { events.push(`image:${id}`); },
      putCloudState: async (state) => { events.push("put"); cloud = state; },
      commitLocal,
    });

    expect(result.state.board).toMatchObject({
      actions: backup.board.actions,
      threads: backup.board.threads,
      intentions: backup.board.intentions,
      principles: backup.board.principles,
      profile: backup.board.profile,
      futureField: { preserved: ["exactly"] },
      historyEpoch: 0,
    });
    expect(result.state.board.ledger.map((entry) => entry.id)).toEqual(["record"]);
    expect(result.state.board.corrections.map((entry) => entry.id)).toEqual(["correction"]);
    expect(result.state.board.wraps?.map((entry) => entry.day)).toEqual(["2026-09-20"]);
    expect(result.state.board.completions?.map((entry) => entry.id)).toEqual(["done"]);
    expect(result.state.tombstones).toEqual([]);
    expect(commitLocal).toHaveBeenCalledTimes(1);
    expect(events.indexOf("put")).toBeGreaterThan(events.findLastIndex((event) => event.startsWith("image:")));
    expect(events.at(-1)).toBe("local");
    expect(events.filter((event) => event === "get")).toHaveLength(2);
  });

  it.each([
    [100, 500],
    [500, 100],
  ])("preserves every archived history stream when archive epoch is %s and current epoch is %s", async (
    archiveEpoch,
    currentEpoch,
  ) => {
    const source = v3();
    const archive = { ...source, board: { ...source.board, historyEpoch: archiveEpoch } };
    const current: SyncState = {
      board: {
        ...EMPTY,
        historyEpoch: currentEpoch,
        ledger: [{ id: "local-record", at: 1, raw: "Local", clean: "Local", kind: "action", source: "typed", targetId: "local" }],
        corrections: [{ id: "local-correction", at: 2, proposalKind: "undone", accepted: false, context: "Local" }],
        wraps: [{
          day: "2026-09-19", at: 3, line: "Local wrap", insights: [], tomorrow: "",
          stats: { day: "2026-09-19", said: 1, threadsMoved: 0, actionsMade: 1, intentions: 0,
            threads: [], firstAt: 1, lastAt: 1, returns: [], finished: [] },
        }],
        completions: [{ id: "local-done", text: "Local done", at: 4 }],
      },
      tombstones: [],
    };
    let cloud = current;
    const result = await restoreBackupV3(archive, {
      authority: cloudAuthority(),
      currentState: current,
      readCloudState: async () => cloud,
      uploadCloudImage: async () => {},
      putCloudState: async (state) => { cloud = mergeSync(cloud, state); },
      commitLocal: async () => {},
    });

    expect(result.state.board.historyEpoch).toBe(currentEpoch);
    expect(result.state.board.ledger.map((entry) => entry.id)).toEqual(expect.arrayContaining(["local-record", "record"]));
    expect(result.state.board.corrections.map((entry) => entry.id)).toEqual(expect.arrayContaining(["local-correction", "correction"]));
    expect(result.state.board.wraps?.map((entry) => entry.day)).toEqual(expect.arrayContaining(["2026-09-19", "2026-09-20"]));
    expect(result.state.board.completions?.map((entry) => entry.id)).toEqual(expect.arrayContaining(["local-done", "done"]));
    expect(result.ledger).toBe(1);
    expect(result.corrections).toBe(1);
    expect(result.wraps).toBe(1);
    expect(result.completions).toBe(1);
  });

  it("is additive: archived tombstones never delete current content and are not activated", async () => {
    const currentAction = {
      id: "keep-current", text: "Current", done: false, at: 1, updatedAt: 1,
      shelf: "keep" as const, expires: null,
    };
    const current: SyncState = {
      board: { ...EMPTY, actions: [currentAction] },
      tombstones: [{ kind: "thread", id: "old-deletion", deletedAt: 2 }],
    };
    const archive = {
      ...v3(),
      scope: { kind: "local" as const },
      tombstones: [{ kind: "action" as const, id: "keep-current", deletedAt: 999 }],
    };
    const result = await restoreBackupV3(archive, {
      authority: localAuthority(),
      currentState: current,
      commitLocal: async () => {},
    });

    expect(result.state.board.actions).toContainEqual(currentAction);
    expect(result.state.tombstones).toEqual(current.tombstones);
  });

  it("does not relabel existing history or mint a receipt on a duplicate restore", async () => {
    const archive = { ...v3(), scope: { kind: "local" as const } };
    const first = await restoreBackupV3(archive, {
      authority: localAuthority(), currentState: { board: EMPTY, tombstones: [] },
      commitLocal: async () => {},
    });
    const receipts = first.state.board.historyImports;
    const second = await restoreBackupV3(archive, {
      authority: localAuthority(), currentState: first.state,
      commitLocal: async () => {},
    });
    expect(second.ledger + second.corrections + second.wraps + second.completions).toBe(0);
    expect(second.state.board.historyImports).toEqual(receipts);
    expect(second.state.board.ledger).toEqual(first.state.board.ledger);
    expect(second.state.board.corrections).toEqual(first.state.board.corrections);
    expect(second.state.board.wraps).toEqual(first.state.board.wraps);
    expect(second.state.board.completions).toEqual(first.state.board.completions);
  });

  it("revives an explicitly restored live item above the destination tombstone", async () => {
    const deletedAt = Date.now();
    const current: SyncState = {
      board: EMPTY,
      tombstones: [{ kind: "action", id: "action", deletedAt }],
    };
    let cloud = current;
    const result = await restoreBackupV3(v3(), {
      authority: cloudAuthority(),
      currentState: current,
      readCloudState: async () => cloud,
      uploadCloudImage: async () => {},
      putCloudState: async (state) => { cloud = mergeSync(cloud, state, deletedAt); },
      commitLocal: async () => {},
    });
    expect(result.state.board.actions.map((item) => item.id)).toContain("action");
    expect(result.state.board.actions.find((item) => item.id === "action")?.updatedAt)
      .toBeGreaterThan(deletedAt);
  });

  it("merges missing archived fragments into a same-id thread, revives them, counts them, and is idempotent", async () => {
    const deletedAt = 100;
    const current: SyncState = {
      board: {
        ...EMPTY,
        threads: [{
          id: "shared-thread",
          name: "Destination name",
          summary: "Destination summary",
          belongs: "Destination metadata",
          updatedAt: 200,
          frags: [{ id: "kept-frag", text: "Destination fragment", at: 10, updatedAt: 200 }],
        }, {
          id: "destination-thread",
          name: "Destination home",
          summary: "",
          updatedAt: 200,
          frags: [{ id: "moved-frag", text: "Moved on destination", at: 15, updatedAt: 200 }],
        }],
      },
      tombstones: [{ kind: "frag", id: "archived-frag", deletedAt }],
    };
    const archive: CaptureBackupV3 = {
      app: BACKUP_APP,
      version: 3,
      exportedAt: "2026-09-21T00:00:00.000Z",
      scope: { kind: "local" },
      complete: true,
      tombstones: [],
      images: {},
      board: {
        ...EMPTY,
        threads: [{
          id: "shared-thread",
          name: "Archived name",
          summary: "Archived summary",
          belongs: "Archived metadata",
          updatedAt: 50,
          frags: [
            { id: "kept-frag", text: "Archived duplicate", at: 10, updatedAt: 50 },
            { id: "moved-frag", text: "Archived old home", at: 15, updatedAt: 50 },
            { id: "archived-frag", text: "Missing archived fragment", at: 20, updatedAt: 20 },
          ],
        }],
      },
    };

    const first = await restoreBackupV3(archive, {
      authority: localAuthority(), currentState: current, commitLocal: async () => {},
    });
    const thread = first.state.board.threads[0];
    expect(thread).toMatchObject({
      name: "Destination name",
      summary: "Destination summary",
      belongs: "Destination metadata",
    });
    expect(thread.frags.map((frag) => frag.id)).toEqual(["kept-frag", "archived-frag"]);
    expect(thread.frags[0].text).toBe("Destination fragment");
    expect(first.state.board.threads[1].frags).toEqual([
      expect.objectContaining({ id: "moved-frag", text: "Moved on destination" }),
    ]);
    expect(thread.frags[1].updatedAt).toBeGreaterThan(deletedAt);
    expect(first).toMatchObject({ threads: 0, fragments: 1 });

    const second = await restoreBackupV3(archive, {
      authority: localAuthority(), currentState: first.state, commitLocal: async () => {},
    });
    expect(second.fragments).toBe(0);
    expect(second.state).toEqual(first.state);
  });

  it("fails closed on an owner transition without committing or PUTting the board", async () => {
    const backup = v3();
    let current = true;
    const putCloudState = vi.fn();
    const commitLocal = vi.fn();
    await expect(restoreBackupV3(backup, {
      authority: {
        kind: "cloud", ownerId: "alice", verifyOwner: async () => "alice",
        assertCurrent: () => { if (!current) throw new Error("Owner transition"); },
      },
      currentState: { board: EMPTY, tombstones: [] },
      readCloudState: async () => ({ board: EMPTY, tombstones: [] }),
      uploadCloudImage: async () => { current = false; },
      putCloudState,
      commitLocal,
    })).rejects.toThrow(/transition/i);
    expect(putCloudState).not.toHaveBeenCalled();
    expect(commitLocal).not.toHaveBeenCalled();
  });

  it("stops before Cloud PUT on a partial media write and never reports success", async () => {
    const backup = v3();
    const prior: SyncState = { board: { ...EMPTY, futureField: "prior" } as Board, tombstones: [] };
    let writes = 0;
    const putCloudState = vi.fn();
    const commitLocal = vi.fn();
    await expect(restoreBackupV3(backup, {
      authority: cloudAuthority(), currentState: prior,
      readCloudState: async () => prior,
      uploadCloudImage: async () => { if (++writes === 2) throw new Error("Image write failed"); },
      putCloudState, commitLocal,
    })).rejects.toThrow(/image write failed/i);
    expect(putCloudState).not.toHaveBeenCalled();
    expect(commitLocal).not.toHaveBeenCalled();
    expect(prior.board).toMatchObject({ futureField: "prior" });
  });

  it("rejects a same-timestamp readback mutation instead of reporting false success", async () => {
    const backup = v3();
    let reads = 0;
    let written: SyncState | null = null;
    const commitLocal = vi.fn();
    await expect(restoreBackupV3(backup, {
      authority: cloudAuthority(), currentState: { board: EMPTY, tombstones: [] },
      readCloudState: async () => {
        if (reads++ === 0) return { board: EMPTY, tombstones: [] };
        return {
          ...(written as unknown as SyncState),
          board: {
            ...(written as unknown as SyncState).board,
            actions: (written as unknown as SyncState).board.actions.map((action) =>
              action.id === "action" ? { ...action, text: "mutated at the same timestamp" } : action),
          },
        };
      },
      uploadCloudImage: async () => {},
      putCloudState: async (state: SyncState) => { written = state; },
      commitLocal,
    })).rejects.toThrow(/could not be verified/i);
    expect(commitLocal).not.toHaveBeenCalled();
  });

  it("does not leak a backup across accounts", async () => {
    const readCloudState = vi.fn();
    const uploadCloudImage = vi.fn();
    const putCloudState = vi.fn();
    const commitLocal = vi.fn();
    await expect(restoreBackupV3(v3("alice"), {
      authority: cloudAuthority("bob"), currentState: { board: EMPTY, tombstones: [] },
      readCloudState, uploadCloudImage, putCloudState, commitLocal,
    })).rejects.toThrow(/different account|owner/i);
    expect(readCloudState).not.toHaveBeenCalled();
    expect(uploadCloudImage).not.toHaveBeenCalled();
    expect(putCloudState).not.toHaveBeenCalled();
    expect(commitLocal).not.toHaveBeenCalled();
  });

  it("keeps the prior local board when the atomic local commit fails", async () => {
    const backup = { ...v3(), scope: { kind: "local" as const } };
    const prior: SyncState = { board: { ...EMPTY, futureField: "prior" } as Board, tombstones: [] };
    await expect(restoreBackupV3(backup, {
      authority: localAuthority(), currentState: prior,
      commitLocal: async () => { throw new Error("storage transaction aborted"); },
    })).rejects.toThrow(/transaction aborted/i);
    expect(prior.board).toMatchObject({ futureField: "prior" });
  });
});
