import { markHistoryImport } from "./historyImport";
import { type Board, type Thread, hydrate } from "./model";
import { mergeCorrections, mergeLedgers } from "./ledger";
import { mergeWraps, mergeCompletions } from "./wrap";
import { allReferencedImageIds, isSafeImageId } from "./imgSync";
import type { Tombstone } from "./sync";

/**
 * Getting the whole board out of the device, and back in.
 *
 * Everything lives in one browser's IndexedDB. Clearing site data, replacing
 * the phone, or the OS evicting the PWA all take the lot with them, and until
 * now there was no way to get a copy out. Export is the more important half of
 * this file: import only matters once something has been exported.
 *
 * Images are included since v2. v3 makes completeness explicit and adds the
 * owner scope plus sync tombstones. Image bytes live per-id outside the board
 * (in IndexedDB under IMG(id)); a v1 backup carried only the ids and a restore
 * silently lost every photo. v1/v2 files remain readable, while v3 cannot be
 * emitted or restored unless every canonical reference has valid raster bytes.
 */

export const BACKUP_APP = "capture";
export const BACKUP_VERSION = 3;

export type BackupScope =
  | { kind: "local" }
  | { kind: "cloud"; ownerId: string };

export type CaptureBackup = {
  app: typeof BACKUP_APP;
  version: number;
  exportedAt: string;
  board: Board;
  /** Image bytes by id, so a restore can bring the photos back. */
  images?: Record<string, string>;
  /** v3 binds Cloud archives to the authenticated account that produced them. */
  scope?: BackupScope;
  /** v3 carries the authoritative deletion state beside the board. */
  tombstones?: Tombstone[];
  /** Present only after every canonical image reference has valid bytes. */
  complete?: true;
  /** Original device entries are archival only; never execute or restore settings. */
  deviceSnapshot?: { version: 1; id: string; entries: [string, string][] };
};

export type CaptureBackupV3 = CaptureBackup & {
  version: 3;
  scope: BackupScope;
  tombstones: Tombstone[];
  images: Record<string, string>;
  complete: true;
};

export function buildBackup(
  board: Board,
  images: Record<string, string> = {},
  tombstones: Tombstone[] = [],
  scope: BackupScope = { kind: "local" }
): CaptureBackupV3 {
  return parseBackupV3({
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    board,
    images,
    scope,
    tombstones,
    complete: true,
  });
}

const OWNER_ID = /^[a-zA-Z0-9_-]{1,128}$/;
const TOMBSTONE_KINDS = new Set(["action", "thread", "frag", "intention", "principle"]);

function validTombstone(value: unknown): value is Tombstone {
  if (!value || typeof value !== "object") return false;
  const tombstone = value as Partial<Tombstone>;
  return typeof tombstone.id === "string" && !!tombstone.id &&
    typeof tombstone.deletedAt === "number" && Number.isFinite(tombstone.deletedAt) &&
    TOMBSTONE_KINDS.has(String(tombstone.kind));
}

/** Validate the payload as raster bytes, not only a claimed MIME type. */
export function validBackupImage(src: unknown): src is string {
  if (typeof src !== "string" || src.length > 3_000_000) return false;
  const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,/.exec(src);
  if (!match) return false;
  const encoded = src.slice(match[0].length);
  let binary: string;
  try {
    binary = atob(encoded);
    if (!binary.length || btoa(binary) !== encoded) return false;
  } catch {
    return false;
  }
  const bytes = Array.from(binary, (character) => character.charCodeAt(0));
  if (match[1] === "image/png")
    return [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte);
  if (match[1] === "image/jpeg")
    return bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (match[1] === "image/webp")
    return binary.slice(0, 4) === "RIFF" && binary.slice(8, 12) === "WEBP";
  return binary.slice(0, 6) === "GIF87a" || binary.slice(0, 6) === "GIF89a";
}

export type BackupImageAttestation = {
  digest: string;
  mime: string;
  length: number;
};

export async function backupImageAttestation(src: string): Promise<BackupImageAttestation> {
  if (!validBackupImage(src)) throw new Error("Invalid backup image.");
  const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,/.exec(src)!;
  const binary = atob(src.slice(match[0].length));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  const digest = [...new Uint8Array(hash)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return { digest, mime: match[1], length: bytes.byteLength };
}

/** Parse the strict v3 envelope. v1/v2 remain on the compatibility path. */
export function parseBackupV3(parsed: unknown): CaptureBackupV3 {
  const backup = parsed as Partial<CaptureBackupV3> | null;
  if (!backup || backup.app !== BACKUP_APP || backup.version !== 3 ||
      backup.complete !== true || !backup.board || !backup.scope ||
      !Array.isArray(backup.tombstones) || !backup.tombstones.every(validTombstone) ||
      !backup.images || typeof backup.images !== "object" || Array.isArray(backup.images)) {
    throw new Error("That isn't a complete Capture backup v3.");
  }
  if (backup.scope.kind !== "local" &&
      !(backup.scope.kind === "cloud" && OWNER_ID.test(backup.scope.ownerId))) {
    throw new Error("That backup has an invalid owner scope.");
  }
  const rawBoard = backup.board as Partial<Board>;
  if (![rawBoard.actions, rawBoard.threads, rawBoard.intentions, rawBoard.principles,
        rawBoard.ledger, rawBoard.corrections].every(Array.isArray)) {
    throw new Error("That complete backup has an unreadable board.");
  }
  const board = rawBoard as Board;
  const references = allReferencedImageIds(board);
  const invalid = references.filter((id) => typeof id !== "string" || !isSafeImageId(id));
  if (invalid.length) {
    throw new Error("A complete backup contains a noncanonical image id.");
  }
  const images: Record<string, string> = {};
  const missing: string[] = [];
  for (const id of references as string[]) {
    const src = backup.images[id];
    if (!validBackupImage(src)) missing.push(id);
    else images[id] = src;
  }
  if (missing.length) {
    throw new Error(`A complete backup could not be verified. Missing or corrupt image: ${missing.join(", ")}.`);
  }
  return {
    app: BACKUP_APP,
    version: 3,
    exportedAt: typeof backup.exportedAt === "string" ? backup.exportedAt : "",
    scope: backup.scope,
    complete: true,
    board,
    tombstones: backup.tombstones,
    images,
    ...(backup.deviceSnapshot ? { deviceSnapshot: backup.deviceSnapshot } : {}),
  };
}

export function backupFilename(now = new Date()) {
  return `capture-backup-${now.toISOString().slice(0, 10)}.json`;
}

export function downloadJSON(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Read a file as JSON, failing in words rather than in parser-speak.
 *
 * "Unexpected token 'o' at position 1" tells the person holding the phone
 * nothing about which file to pick instead.
 */
export async function readJsonFile(file: File): Promise<unknown> {
  let text: string;
  try {
    text = await file.text();
  } catch {
    throw new Error("That file couldn't be opened.");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `"${file.name}" isn't readable as JSON. Backups are .json files — check you picked the right one.`
    );
  }
}

export type RestoreResult = {
  board: Board;
  actions: number;
  threads: number;
  fragments: number;
  intentions: number;
  principles: number;
  /** The backup's image bytes, to be written back into IndexedDB. The caller
      decides which ids the merged board still references; an image whose id
      is not on the board is simply not restored. */
  images?: Record<string, string>;
  version: number;
  tombstones?: Tombstone[];
};

/** Stamp only additions so an explicit compatibility restore out-ages old
 * tombstones without rewriting destination-owned records. */
export function stampRestoredAdditions(
  result: RestoreResult,
  before: Board,
  updatedAt: number,
): RestoreResult {
  const fresh = <T extends { id: string; updatedAt?: number }>(current: T[], after: T[]) =>
    after.map((item) => current.some((old) => old.id === item.id)
      ? item : { ...item, updatedAt });
  return { ...result, board: {
    ...result.board,
    actions: fresh(before.actions, result.board.actions),
    threads: fresh(before.threads, result.board.threads),
    intentions: fresh(before.intentions, result.board.intentions),
  } };
}

/**
 * Merge a backup into the board rather than replacing it.
 *
 * Matched on id throughout, so restoring onto a device that already has some
 * of this is safe and restoring twice changes nothing the second time. What
 * is already here always wins — a restore can add, never overwrite.
 */
export function restoreBackup(
  parsed: unknown,
  board: Board,
  options: { historyBatch?: string; mergeThreadFragments?: boolean } = {},
): RestoreResult {
  const candidate = parsed as Partial<CaptureBackup> | null;
  if (candidate?.version !== undefined && ![1, 2, 3].includes(candidate.version)) {
    throw new Error("That Capture backup version is not supported by this app.");
  }
  const backup = candidate?.version === 3 ? parseBackupV3(parsed) : candidate;
  if (!backup || backup.app !== BACKUP_APP || !backup.board) {
    throw new Error(
      "That isn't a capture backup. Use the file this app exported — an intent backup goes in the box below."
    );
  }

  const snapshot = backup.deviceSnapshot;
  const originalArchive = snapshot?.version === 1 && typeof snapshot.id === "string" &&
    /^[a-zA-Z0-9_-]{1,128}$/.test(snapshot.id) && Array.isArray(snapshot.entries);
  // This call is the explicit Restore action, not a sync/retry callback.
  // Give each authorized recovery its own receipt: the same archive may be
  // requested again after a reset. The returned board persists this identity
  // in historyImports/importBatch; reloads and network retries reuse it.
  const hydrated = hydrate(backup.board);
  const prepared = options.historyBatch ? {
    ...hydrated,
    ledger: (hydrated.ledger ?? []).filter((entry) =>
      !(board.ledger ?? []).some((current) => current.id === entry.id)),
    corrections: (hydrated.corrections ?? []).filter((entry) =>
      !(board.corrections ?? []).some((current) => current.id === entry.id)),
    wraps: (hydrated.wraps ?? []).filter((entry) =>
      !(board.wraps ?? []).some((current) => current.day === entry.day)),
    completions: (hydrated.completions ?? []).filter((entry) =>
      !(board.completions ?? []).some((current) => current.id === entry.id)),
  } : hydrated;
  const hasImportHistory = !!options.historyBatch && [
    prepared.ledger, prepared.corrections, prepared.wraps, prepared.completions,
  ].some((entries) => (entries?.length ?? 0) > 0);
  const incoming = hasImportHistory
    ? markHistoryImport(prepared, board, options.historyBatch!)
    : originalArchive
      ? markHistoryImport(hydrated, board, `recovery-${crypto.randomUUID()}`)
      : prepared;
  // Carry unknown board fields too. Conflicts still keep the destination;
  // the original download is the lossless archive, not a destructive restore.
  const merged = { ...incoming, ...board,
    ...((originalArchive || hasImportHistory) ? {
      historyImports: { ...incoming.historyImports, ...board.historyImports },
    } : {}),
  };
  const counts = { actions: 0, threads: 0, fragments: 0, intentions: 0, principles: 0 };
  const images = backup.images || undefined;

  const haveActions = new Set(board.actions.map((a) => a.id));
  const newActions = incoming.actions.filter((a) => a?.id && !haveActions.has(a.id));
  counts.actions = newActions.length;
  merged.actions = [...board.actions, ...newActions];

  const haveThreads = new Set(board.threads.map((t) => t.id));
  const newThreads = incoming.threads.filter((t) => t?.id && !haveThreads.has(t.id));
  counts.threads = newThreads.length;
  if (options.mergeThreadFragments) {
    const archivedThreads = new Map(incoming.threads.map((thread) => [thread.id, thread]));
    const haveFragments = new Set(board.threads.flatMap((thread) =>
      thread.frags.map((frag) => frag.id)));
    const missingFragments = (thread: Thread) => thread.frags.filter((frag) => {
      if (!frag?.id || haveFragments.has(frag.id)) return false;
      haveFragments.add(frag.id);
      return true;
    });
    merged.threads = board.threads.map((thread) => {
      const archived = archivedThreads.get(thread.id);
      if (!archived) return thread;
      const missing = missingFragments(archived);
      counts.fragments += missing.length;
      return missing.length
        ? { ...thread, frags: [...thread.frags, ...missing].sort((a, b) => a.at - b.at) }
        : thread;
    });
    merged.threads.push(...newThreads.map((thread) => {
      const frags = missingFragments(thread);
      counts.fragments += frags.length;
      return { ...thread, frags };
    }));
  } else {
    merged.threads = [...board.threads, ...newThreads];
  }

  const haveIntentions = new Set(board.intentions.map((i) => i.id));
  const newIntentions = incoming.intentions.filter(
    (i) => i?.id && !haveIntentions.has(i.id)
  );
  counts.intentions = newIntentions.length;
  merged.intentions = [...board.intentions, ...newIntentions].sort(
    (a, b) => b.at - a.at
  );

  // Principles match on name: the builtins are seeded on every device, so
  // matching on id would duplicate all fifteen of them on restore.
  const havePrinciples = new Set(board.principles.map((p) => p.name));
  const newPrinciples = incoming.principles.filter(
    (p) => p?.name && !havePrinciples.has(p.name)
  );
  counts.principles = newPrinciples.length;
  merged.principles = [...board.principles, ...newPrinciples];

  // Ledger entries are immutable and id-unique, so a restore is add-only.
  // Mark only entries introduced here: restoring the same backup must not
  // relabel captures that were already made in this browser.
  const haveLedger = new Set((board.ledger ?? []).map((e) => e.id));
  const restoredLedger = (incoming.ledger ?? [])
    .filter((e) => !haveLedger.has(e.id))
    .map((e) => ({ ...e, restored: true }));
  merged.ledger = mergeLedgers(board.ledger ?? [], restoredLedger);
  // Same for corrections: a restore never rewrites what this device learned.
  merged.corrections = mergeCorrections(
    board.corrections ?? [],
    incoming.corrections ?? []
  );
  /* The rest of the history travels the same way. This is the third place
     that has to name every Board field by hand — hydrate and the sync merge
     are the others — and the one most easily forgotten, because a restore is
     rare and its loss is silent: the wraps and the ticks simply are not
     there afterwards, with nothing to say they ever were. */
  merged.wraps = mergeWraps(board.wraps ?? [], incoming.wraps ?? []);
  merged.completions = mergeCompletions(
    board.completions ?? [],
    incoming.completions ?? []
  );
  /* The epoch takes the later of the two, so a restore cannot make this
     device look older than it is and lose its history at the next sync.

     Unlike a sync, the history riding in on an older epoch is kept. A sync
     drops it because nobody asked for it — it is another device catching up
     with a wipe. A restore is the opposite: the person went and found this
     file and chose to bring it back, and silently discarding what is in it
     because of a wipe they may well be undoing would be the wrong reading
     of the request. */
  merged.historyEpoch = Math.max(
    board.historyEpoch ?? 0,
    incoming.historyEpoch ?? 0
  );
  /* Restore is add-only. Keep this device's profile when it has one; an
     older backup may supply a profile only when this board has none. */
  merged.profile = board.profile ?? incoming.profile;

  return {
    board: merged,
    ...counts,
    images,
    version: typeof backup.version === "number" ? backup.version : 1,
    ...(backup.version === 3 ? { tombstones: backup.tombstones } : {}),
  };
}
