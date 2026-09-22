import {
  backupImageAttestation,
  parseBackupV3,
  validBackupImage,
  type BackupImageAttestation,
  type CaptureBackupV3,
} from "./backup";
import {
  exportBackupV3,
  restoreBackupV3,
  type BackupAuthority,
  type BackupProgress,
} from "./backupTransfer";
import { imgLoad } from "./imgCache";
import { IMG, KEY, hydrate, type Board } from "./model";
import {
  type OwnershipLifetime,
  verifyCloudIdentity,
} from "./ownership";
import { createStorage } from "./storage";
import { TOMBSTONE_KEY, type SyncState } from "./sync";
import { referencedImageIds } from "./imgSync";

const MAX_BACKUP_RETRY_AFTER_SECONDS = 60;
const MAX_BACKUP_RETRIES = 3;

export async function requestBackupTransfer(
  operation: () => Promise<Response>,
  wait: (milliseconds: number) => Promise<void> = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
): Promise<Response> {
  let retries = 0;
  while (true) {
    const response = await operation();
    if (response.status !== 429 || retries++ >= MAX_BACKUP_RETRIES) return response;
    const retryAfter = Number(response.headers.get("Retry-After"));
    if (!Number.isSafeInteger(retryAfter) || retryAfter < 1 ||
        retryAfter > MAX_BACKUP_RETRY_AFTER_SECONDS) return response;
    await wait(retryAfter * 1_000);
  }
}

export async function repairLegacyBackupImages(
  board: Board,
  images: Record<string, string>,
  read: (id: string) => Promise<string | null>,
  write: (id: string, src: string) => Promise<void>,
): Promise<void> {
  for (const id of referencedImageIds(board)) {
    const archived = images[id];
    // v2 predates strict raster attestation. Preserve its historical data-URL
    // compatibility while using today's validator to decide whether local bytes
    // need repair; strict v3 never reaches this compatibility path.
    if (typeof archived !== "string" || !archived.startsWith("data:image/")) continue;
    if (!validBackupImage(await read(id))) await write(id, archived);
  }
}

/** Persist a compatibility restore as one durable unit. Existing valid bytes
 * win; v2 archive bytes repair only missing/corrupt canonical references. */
export async function commitLegacyBackup(
  lifetime: OwnershipLifetime,
  state: SyncState,
  images: Record<string, string> = {},
): Promise<void> {
  const store = createStorage(lifetime);
  await store.atomic((entries) => {
    lifetime.assertOnline();
    entries.set(KEY, JSON.stringify(state.board));
    entries.set(TOMBSTONE_KEY, JSON.stringify(state.tombstones));
    for (const id of referencedImageIds(state.board)) {
      const archived = images[id];
      if (typeof archived !== "string" || !archived.startsWith("data:image/")) continue;
      if (!validBackupImage(entries.get(IMG(id)))) entries.set(IMG(id), archived);
    }
  });
}

async function errorMessage(response: Response, fallback: string): Promise<string> {
  const value = await response.json().catch(() => null) as { error?: unknown } | null;
  return typeof value?.error === "string" ? value.error : fallback;
}

/** Concrete browser I/O for the pure v3 transfer policy. Every request passes
 * through one immutable OwnershipLifetime, so account changes abort the whole
 * operation rather than letting a later step use successor cookies. */
export function createBackupClient(lifetime: OwnershipLifetime) {
  const request = lifetime.request.bind(lifetime);
  const transferRequest = (input: RequestInfo | URL, init?: RequestInit) =>
    requestBackupTransfer(() => request(input, init));
  const authority = (): BackupAuthority => lifetime.cloud && lifetime.owner
    ? {
        kind: "cloud",
        ownerId: lifetime.owner,
        verifyOwner: async () => (await verifyCloudIdentity()).owner,
        assertCurrent: () => lifetime.assertOnline(),
      }
    : {
        kind: "local",
        assertCurrent: () => lifetime.assertDisclosure(),
      };

  const readCloudState = async (): Promise<SyncState> => {
    const response = await transferRequest("/api/cloud/board?backup=1");
    if (!response.ok) throw new Error(await errorMessage(response, "Capture Cloud board is unavailable."));
    const value = await response.json() as Partial<SyncState>;
    if (!value.board || !Array.isArray(value.tombstones)) {
      throw new Error("Capture Cloud returned an unreadable board.");
    }
    return { board: hydrate(value.board), tombstones: value.tombstones };
  };

  const readCloudImage = async (id: string): Promise<string | null> => {
    const response = await transferRequest(`/api/img/${id}?backup=1`);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Picture ${id} is unavailable in Capture Cloud.`);
    const value = await response.json() as { src?: unknown };
    return typeof value.src === "string" ? value.src : null;
  };

  const uploadCloudImage = async (id: string, src: string) => {
    const expected = await backupImageAttestation(src);
    const response = await transferRequest(`/api/img/${id}?backup=1`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ src }),
    });
    if (!response.ok) {
      throw new Error(await errorMessage(response, `Picture ${id} could not be restored.`));
    }
    const acknowledged = await response.json().catch(() => null) as
      Partial<BackupImageAttestation> | null;
    if (!acknowledged || acknowledged.digest !== expected.digest ||
        acknowledged.mime !== expected.mime || acknowledged.length !== expected.length) {
      throw new Error(`Picture ${id} could not be verified after restore.`);
    }
  };

  const putCloudState = async (state: SyncState) => {
    const response = await transferRequest("/api/cloud/board", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state),
    });
    if (!response.ok) {
      throw new Error(await errorMessage(response, "Capture Cloud restore was not accepted."));
    }
    // Consume the owner-guarded body before the readback. A delayed auth
    // transition must still abort here even though only the GET is authoritative.
    await response.json();
  };

  const commitLocal = async (state: SyncState, images: Record<string, string>) => {
    const store = createStorage(lifetime);
    await store.atomic((entries) => {
      lifetime.assertOnline();
      entries.set(KEY, JSON.stringify(state.board));
      entries.set(TOMBSTONE_KEY, JSON.stringify(state.tombstones));
      for (const [id, src] of Object.entries(images)) entries.set(IMG(id), src);
    });
  };

  return {
    async exportV3(localState: SyncState, onProgress?: (progress: BackupProgress) => void): Promise<CaptureBackupV3> {
      const owner = authority();
      return exportBackupV3({
        authority: owner,
        localState,
        readLocalImage: imgLoad,
        ...(owner.kind === "cloud" ? { readCloudState, readCloudImage } : {}),
        onProgress,
      });
    },

    async restoreV3(
      parsed: unknown,
      currentState: SyncState,
      onProgress?: (progress: BackupProgress) => void,
    ) {
      // Parse before opening the cross-tab import generation. A malformed file
      // must not retire healthy tabs or touch an account namespace.
      parseBackupV3(parsed);
      const owner = authority();
      if (owner.kind === "cloud") lifetime.beginImport();
      try {
        return await restoreBackupV3(parsed, {
          authority: owner,
          currentState,
          ...(owner.kind === "cloud"
            ? { readCloudState, uploadCloudImage, putCloudState }
            : {}),
          commitLocal,
          onProgress,
        });
      } finally {
        if (owner.kind === "cloud") lifetime.finishImport();
      }
    },
  };
}
