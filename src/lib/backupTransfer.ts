import {
  buildBackup,
  parseBackupV3,
  restoreBackup,
  validBackupImage,
  type CaptureBackupV3,
} from "./backup";
import { referencedImageIds } from "./imgSync";
import type { Board } from "./model";
import { mergeSync, type SyncState, type TombstoneKind } from "./sync";

export type BackupProgress = {
  phase: "verifying" | "board" | "images" | "uploading" | "saving" | "ready";
  completed: number;
  total: number;
};

export function backupProgressText(progress: BackupProgress, restore = false): string {
  if (progress.phase === "verifying") return "Verifying account…";
  if (progress.phase === "board") return restore ? "Checking Cloud board…" : "Fetching Cloud board…";
  if (progress.phase === "images") return `Fetching ${progress.completed} of ${progress.total} pictures…`;
  if (progress.phase === "uploading") return `Restoring ${progress.completed} of ${progress.total} pictures…`;
  if (progress.phase === "saving") return "Saving restored backup…";
  return restore ? "Finishing restore…" : "Preparing download…";
}

export type BackupAuthority =
  | { kind: "local"; assertCurrent: () => void }
  | {
      kind: "cloud";
      ownerId: string;
      verifyOwner: () => Promise<string | null>;
      assertCurrent: () => void;
    };

type CommonOptions = {
  authority: BackupAuthority;
  currentState: SyncState;
  onProgress?: (progress: BackupProgress) => void;
};

export type ExportBackupV3Options = {
  authority: BackupAuthority;
  localState: SyncState;
  readLocalImage: (id: string) => Promise<string | null>;
  readCloudState?: () => Promise<SyncState>;
  readCloudImage?: (id: string) => Promise<string | null>;
  onProgress?: (progress: BackupProgress) => void;
  onComplete?: (backup: CaptureBackupV3) => void;
};

export type RestoreBackupV3Options = CommonOptions & {
  readCloudState?: () => Promise<SyncState>;
  uploadCloudImage?: (id: string, src: string) => Promise<void>;
  putCloudState?: (state: SyncState) => Promise<void>;
  /** Must commit board, tombstones and every image in one local transaction. */
  commitLocal: (state: SyncState, images: Record<string, string>) => Promise<void>;
};

async function guarded<T>(authority: BackupAuthority, operation: () => Promise<T>): Promise<T> {
  authority.assertCurrent();
  const result = await operation();
  authority.assertCurrent();
  return result;
}

async function verifyAuthority(authority: BackupAuthority): Promise<void> {
  authority.assertCurrent();
  if (authority.kind === "local") return;
  const verified = await guarded(authority, authority.verifyOwner);
  if (verified !== authority.ownerId) {
    throw new Error("The verified account owner changed. Reload before trying again.");
  }
}

function emit(
  callback: ((progress: BackupProgress) => void) | undefined,
  phase: BackupProgress["phase"],
  completed = 0,
  total = 0,
) {
  callback?.({ phase, completed, total });
}

export async function exportBackupV3(options: ExportBackupV3Options): Promise<CaptureBackupV3> {
  emit(options.onProgress, "verifying");
  await verifyAuthority(options.authority);

  let state = options.localState;
  if (options.authority.kind === "cloud") {
    if (!options.readCloudState || !options.readCloudImage) {
      throw new Error("Cloud backup is unavailable.");
    }
    emit(options.onProgress, "board");
    state = await guarded(options.authority, options.readCloudState);
  }

  options.authority.assertCurrent();
  const ids = referencedImageIds(state.board);
  const images: Record<string, string> = {};
  let completed = 0;
  emit(options.onProgress, "images", completed, ids.length);
  for (const id of ids) {
    let src = await guarded(options.authority, () => options.readLocalImage(id));
    if (!validBackupImage(src) && options.authority.kind === "cloud") {
      src = await guarded(options.authority, () => options.readCloudImage!(id));
    }
    if (!validBackupImage(src)) {
      throw new Error(`A complete backup could not be created. Missing or corrupt image: ${id}.`);
    }
    images[id] = src;
    emit(options.onProgress, "images", ++completed, ids.length);
  }

  options.authority.assertCurrent();
  const scope = options.authority.kind === "cloud"
    ? { kind: "cloud" as const, ownerId: options.authority.ownerId }
    : { kind: "local" as const };
  const backup = buildBackup(state.board, images, state.tombstones, scope);
  options.authority.assertCurrent();
  emit(options.onProgress, "ready", ids.length, ids.length);
  options.onComplete?.(backup);
  return backup;
}

function assertBackupScope(backup: CaptureBackupV3, authority: BackupAuthority) {
  if (authority.kind === "cloud") {
    if (backup.scope.kind !== "cloud" || backup.scope.ownerId !== authority.ownerId) {
      throw new Error("This backup belongs to a different account owner.");
    }
  } else if (backup.scope.kind !== "local") {
    throw new Error("A Cloud backup can only be restored by its verified account owner.");
  }
}

function countAdded(before: SyncState, after: SyncState) {
  const ids = <T extends { id: string }>(items: T[]) => new Set(items.map((item) => item.id));
  const keys = <T>(items: T[], key: (item: T) => string) => new Set(items.map(key));
  const actions = ids(before.board.actions);
  const threads = ids(before.board.threads);
  const fragments = ids(before.board.threads.flatMap((thread) => thread.frags));
  const intentions = ids(before.board.intentions);
  const principles = ids(before.board.principles);
  const ledger = ids(before.board.ledger ?? []);
  const corrections = ids(before.board.corrections ?? []);
  const wraps = keys(before.board.wraps ?? [], (item) => item.day);
  const completions = ids(before.board.completions ?? []);
  return {
    actions: after.board.actions.filter((item) => !actions.has(item.id)).length,
    threads: after.board.threads.filter((item) => !threads.has(item.id)).length,
    fragments: after.board.threads.flatMap((thread) => thread.frags)
      .filter((item) => !fragments.has(item.id)).length,
    intentions: after.board.intentions.filter((item) => !intentions.has(item.id)).length,
    principles: after.board.principles.filter((item) => !principles.has(item.id)).length,
    ledger: (after.board.ledger ?? []).filter((item) => !ledger.has(item.id)).length,
    corrections: (after.board.corrections ?? []).filter((item) => !corrections.has(item.id)).length,
    wraps: (after.board.wraps ?? []).filter((item) => !wraps.has(item.day)).length,
    completions: (after.board.completions ?? []).filter((item) => !completions.has(item.id)).length,
    profile: !before.board.profile && !!after.board.profile ? 1 : 0,
  };
}

function reviveRestoredItems(current: SyncState, restored: Board): Board {
  const deleted = new Map(current.tombstones.map((item) => [
    `${item.kind}:${item.id}`,
    item.deletedAt,
  ]));
  const revive = <T extends { id: string; updatedAt?: number; at?: number }>(
    kind: TombstoneKind,
    item: T,
    existing: Set<string>,
  ): T => {
    if (existing.has(item.id)) return item;
    const deletedAt = deleted.get(`${kind}:${item.id}`);
    const itemAt = item.updatedAt ?? item.at ?? 0;
    return deletedAt !== undefined && deletedAt >= itemAt
      ? { ...item, updatedAt: deletedAt + 1 }
      : item;
  };
  const ids = <T extends { id: string }>(items: T[]) => new Set(items.map((item) => item.id));
  const currentFrags = new Set(current.board.threads.flatMap((thread) =>
    thread.frags.map((frag) => frag.id)));
  return {
    ...restored,
    actions: restored.actions.map((item) => revive("action", item, ids(current.board.actions))),
    threads: restored.threads.map((thread) => {
      const revived = revive("thread", thread, ids(current.board.threads));
      return {
        ...revived,
        frags: revived.frags.map((frag) => revive("frag", frag, currentFrags)),
      };
    }),
    intentions: restored.intentions.map((item) =>
      revive("intention", item, ids(current.board.intentions))),
    principles: restored.principles.map((item) =>
      revive("principle", item, ids(current.board.principles))),
  };
}

/** True when the readback structurally contains the planned restore. Merging in
 * the readback first would hide same-timestamp corruption because LWW keeps its
 * first argument on ties; planned-first makes any missing/different field
 * visible in the canonical comparison. */
function containsState(readback: SyncState, planned: SyncState): boolean {
  const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)));
  });
  return canonical(mergeSync(planned, readback)) === canonical(readback);
}

export async function restoreBackupV3(parsed: unknown, options: RestoreBackupV3Options) {
  const backup = parseBackupV3(parsed);
  assertBackupScope(backup, options.authority);
  emit(options.onProgress, "verifying");
  await verifyAuthority(options.authority);

  let current = options.currentState;
  if (options.authority.kind === "cloud") {
    if (!options.readCloudState || !options.uploadCloudImage || !options.putCloudState) {
      throw new Error("Cloud restore is unavailable.");
    }
    emit(options.onProgress, "board");
    current = await guarded(options.authority, options.readCloudState);
  }

  const before = current;
  // Explicit restore has different history and deletion semantics from sync:
  // archive history is deliberately imported across either epoch ordering,
  // while archived tombstones remain archive evidence and never delete the
  // destination's current content.
  const restored = restoreBackup(backup, current.board, {
    historyBatch: `restore-${crypto.randomUUID()}`,
    mergeThreadFragments: true,
  });
  const planned: SyncState = {
    board: reviveRestoredItems(current, restored.board),
    tombstones: current.tombstones,
  };
  const imageEntries = Object.entries(backup.images);

  if (options.authority.kind === "cloud") {
    let completed = 0;
    emit(options.onProgress, "uploading", completed, imageEntries.length);
    // PUT every immutable image. Unlike HEAD, the Cloud PUT acknowledgement
    // validates the winner's digest/MIME/length before the board can reference it.
    for (const [id, src] of imageEntries) {
      await guarded(options.authority, () => options.uploadCloudImage!(id, src));
      emit(options.onProgress, "uploading", ++completed, imageEntries.length);
    }
    options.authority.assertCurrent();
    await guarded(options.authority, () => options.putCloudState!(planned));
    const readback = await guarded(options.authority, options.readCloudState!);
    if (!containsState(readback, planned)) {
      throw new Error("Cloud restore could not be verified. Your prior local board is unchanged.");
    }
    current = readback;
  } else {
    current = planned;
  }

  emit(options.onProgress, "saving", imageEntries.length, imageEntries.length);
  await guarded(options.authority, () => options.commitLocal(current, backup.images));
  options.authority.assertCurrent();
  emit(options.onProgress, "ready", imageEntries.length, imageEntries.length);
  return {
    state: current,
    images: backup.images,
    ...countAdded(before, current),
  };
}
