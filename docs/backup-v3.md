# Capture backup v3

Backup v3 is the complete, owner-bound archive format used by **Settings →
Data and sync → Download backup**. Export and restore are client-orchestrated so
no route must hold the whole archive or run for the duration of a large board.

## Envelope

```ts
type CaptureBackupV3 = {
  app: "capture";
  version: 3;
  exportedAt: string;
  scope:
    | { kind: "local" }
    | { kind: "cloud"; ownerId: string };
  complete: true;
  board: Board;
  tombstones: Tombstone[];
  images: Record<string, string>; // canonical image id -> raster data URL
};
```

`complete: true` is a verified claim, not a best-effort label. The client walks
`referencedImageIds(board)`, which covers Action images, Thread fragment images,
Thread image covers, Intention images, live pending-ledger evidence, and the
profile photo. Each reference must have canonical base64 bytes whose signature
matches PNG, JPEG, WebP, or GIF. Extra image-map entries are not restored.

A complete explicit owner backup is deliberately lossless. It includes pending
capture envelopes and their images because this archive is private recovery data
bound to the exact owner, not a settled-content share or model disclosure.
Search, Record/statistics, readable shares/exports, Wrap/Tidy, and AI/model routes
continue to omit pending content until classification.

Cloud archives include the exact authenticated owner ID. A v3 Cloud archive is
not portable to another account. Local/self-hosted archives use `kind: "local"`.

## Export

### Capture Cloud

1. `verifyCloudIdentity()` must return the immutable document owner.
2. `GET /api/cloud/board?backup=1` supplies the authoritative Board and
   tombstones through an exact-owner, durable `backup_read` quota. This recovery
   read remains available after billing expiry; board writes and AI do not.
3. For each canonical image ID, use valid bytes from the owner's local
   IndexedDB; otherwise `GET /api/img/:id?backup=1` through the same recovery
   authorization and a separately bounded image-transfer lane.
4. Recheck owner authority after every asynchronous boundary.
5. Validate the complete envelope, then trigger the download.

Missing, malformed, non-raster, oversized, or unavailable media aborts the
operation. No partial archive is downloaded and no success note is shown.

### Local/self-hosted

The current local Board and tombstones are authoritative. The same canonical
walk and raster validation apply, but export does not invent a Cloud owner or
silently omit bytes that are absent from local storage.

## Restore

### v3 Cloud

1. Parse and validate the complete envelope locally.
2. Require `scope.ownerId` to equal the freshly verified current owner.
3. Read the current owner-bound Cloud state and perform an explicit additive
   restore merge. Current records win conflicts; archived ledger, corrections,
   wraps, and completions are imported across either history-epoch ordering.
   Archived tombstones stay in the archive and are never applied as current
   deletions, so restore cannot remove content already on the destination.
4. `PUT /api/img/:id?backup=1` for every archive image. The response attests
   the stored winner's SHA-256 digest, MIME, and byte length; all three must
   match the archive before the board PUT. Any failure stops before the board
   PUT. `429 Retry-After` resumes the same item with a bounded wait/retry budget.
5. `PUT /api/cloud/board` with the merged Board and tombstones.
6. GET the owner-bound board again and verify it contains the planned state.
7. In one IndexedDB transaction, write Board, tombstones, and all image bytes
   into `capture-cloud-v1-account-<owner>`; only after it commits does React
   adopt the restored board and show success.

An account transition revokes the lifetime and aborts queued storage/network
work. A synchronous document mutex rejects duplicate same-turn starts and holds
commits, sync pulls/pushes, and navigation while restore is active; generation
checks discard replies that began before the restore. Every exit releases only
its own token. A failed IndexedDB transaction rolls back every local key. Images
written before a later failure are harmless unreferenced immutable objects; the
prior visible board is retained and retrying the same restore is idempotent.

### v3 local/self-hosted

Only a `scope.kind === "local"` archive is accepted. Board, tombstones, and
images commit in one local IndexedDB transaction. A transaction failure leaves
the prior Board and media unchanged.

## Compatibility

- **v1:** Board only. Restore remains additive and cannot recreate image bytes
  that the historical format never carried.
- **v2:** Board plus optional image map. Restore keeps the historical additive,
  destination-wins behavior and repairs absent/corrupt local bytes for every
  referenced ID, including IDs that the destination board already referenced.
- **v3:** Strict complete media, tombstones, and owner scope. Cloud uses the
  authenticated export/restore protocol above.

Do not reinterpret v1/v2 as complete archives, and do not downgrade a malformed
v3 file to the legacy path.

## Implementation map

- `src/lib/backup.ts` — envelope types, parser, raster validation, legacy merge.
- `src/lib/backupTransfer.ts` — pure export/restore sequencing and invariants.
- `src/lib/backupClient.ts` — browser owner/API/IndexedDB adapters.
- `src/hooks/useBoard.ts` — Settings orchestration and visible progress/result.
- `src/lib/backupTransfer.test.ts` — lossless, media, owner, ordering, rollback.
- `src/lib/backupClient.test.ts` — real IndexedDB transaction rollback.
- `src/hooks/useBoard.accountIsolation.test.ts` — real hook and account boundary.
