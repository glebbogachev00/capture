# Offline/import correctness follow-up — 2026-09-13

Local changes only, on the pre-existing dirty tree at `c1b0a9c6b426096f5c864050abccc61212deb4b5`. Read the complete independent reviewer report before editing. No commits, deployments, provider writes, environment-file reads, or shared build writes. `useBoard.ts` and `useCaptureLimit.ts` were not edited by this worker.

## Fixes and red-capable evidence

### Unrelated legacy history epochs

`npx vitest run src/lib/legacyImport.test.ts -t undownloaded` failed in both directions before the fix: source epoch 100 / destination 0 retained only source; source 0 / destination 100 retained only destination.

The importer no longer exports the source board's history-reset authority. `markHistoryImport` uses the local destination epoch (zero if absent), tags the four history collections, and records pending import batches. A losing epoch still contributes pending explicit imported records, but not unrelated stale account history. Ordinary epoch/reset comparison is unchanged.

A paid, owner-verified Cloud write merges against the repository's current state and atomically acknowledges batches with the resulting board. Optimistic-write retries rerun this operation against the new destination revision. Accepted receipts win over stale pending copies and survive later history resets, preventing replay from restoring wiped imported history. Receipt changes participate in the board signature.

Verification now covers both epoch orderings, both downloaded/undownloaded destinations, both merge directions, all four history collections, unpaid 402 with no repository access, offline reopen, subsequent entitlement, concurrent destination update/CAS retry, acceptance, and retry after an intentional reset. Provider identity, entitlement and repository in these tests are explicitly mocked; importer, IndexedDB adapter, merge and route handler are real.

The importer still requires an online verified destination and explicit source-access consent to begin. It performs no HTTP requests and requires no paid plan. Its completed local copy can remain pending offline/unpaid; it does not claim a Cloud backup. Existing request-size and paid-access boundaries remain intact.

### Startup image deletion

`npx vitest run src/lib/sweep.retention.test.ts` initially failed both done/faded cases: retained photo bytes read back as null.

Automatic sweep now removes obsolete actions without deleting image bytes. Deleting based on the swept action (or even a single board snapshot's references) is unsafe for Records, daily snapshots, and concurrent edits. No new garbage collector was introduced; this favors preservation over reclaiming orphaned bytes. Immutable image upload behavior is unchanged.

### Import retirement versus offline consent

`src/lib/ownership.importConsent.test.ts` reproduced removed consent through both assertion and storage-event paths. Additional red tests caught delayed server rejection, delayed verification success/failure without a delivered storage event, and late import-finally generation publication after revocation.

Retiring an import-stale document aborts it permanently without clearing the device grant. Logout/account transitions, explicit disable and current-document server rejection retain their existing revocation behavior. Async request/verification continuations check generation before acting; retired verification callbacks cannot revive state or remove successor consent. A revoked import cannot publish a late finished generation.

### Original archive recovery

`npx vitest run src/lib/backup.recovery.test.ts` initially lost unknown root/profile fields. A further archive regression initially reduced 501 original Records to 500.

Restore now spreads incoming and destination boards instead of silently dropping unknown incoming fields. Profile hydration spreads the original valid profile before normalizing supported fields. Destination conflicts and an existing account profile still win. Original-device archive restores mark explicit history additions, retain full imported history and do not transmit an unrelated source reset epoch.

The real importer → original archive download → Restore → hydration test verifies unknown board/profile fields and preservation of opaque device entries in the original archive. The download itself continues to contain the complete unchanged key/value snapshot and original photos. Unsupported device entries are **archive-only**; Restore does not execute/apply those settings. Settings now states this explicitly and asks the user to keep the original file. This is not a claim of exact full-device restoration or lossless conflict resolution into a populated destination.

A regression also reproduced Undo dropping import receipts and recovered unknown fields. `restoreCapture` now spreads snapshot/current boards before its existing targeted overrides. The Board-field guard includes `historyImports`.

## Verification

Final commands/results:

- Targeted affected paths: `npx vitest run src/lib/legacyImport.test.ts src/lib/ownership.importConsent.test.ts src/lib/backup.recovery.test.ts src/lib/sweep.retention.test.ts src/lib/cloudBoard.test.ts src/lib/boardFields.test.ts src/lib/undoOps.test.ts src/components/LegacyImport.test.tsx --maxWorkers=2` — **8 files, 67 tests passed**.
- `npx vitest run --maxWorkers=2` — **153 files, 1,270 tests passed**.
- `npx tsc --noEmit --incremental false` — passed.
- `npm run lint` — passed, with the pre-existing unused `Frag` warning in `src/lib/fragOps.ts`.
- `git diff --check` — passed.

The first unrestricted `npm test` run passed 1,265 tests and failed two wall-clock checks in `organize.performance.test.ts` under contention. The performance file passed alone (all three tests); the full bounded-worker suite passed twice, including the final state. No timeout or performance assertion was weakened.

No browser acceptance or build was run in this follow-up. React UI tests use jsdom; IndexedDB tests use fake-indexeddb. Historical isolated-browser reports are not evidence for this patch. Live Supabase two-account identity/RLS/image isolation, real paid/unpaid entitlement, actual second-device recovery and physical installed-PWA airplane mode remain external acceptance gates.

## Limits / rollout cautions

- No blind migration of previously completed pre-fix imports: a persisted unrelated epoch cannot safely be distinguished from a genuine later reset using the epoch alone. These fixes cover new imports and original-archive recovery; they do not recover destination history already erased by earlier sync. Preserve the original archive and compare any already-imported test/account state with a verified destination before repair.
- Unreferenced image bytes may occupy more local storage because sweep is not a safe complete garbage-collection boundary.
- A normal add-only Restore keeps existing ID/profile conflicts; it is not a replacement/replay of arbitrary device settings. Keep the original archive for unsupported fields or conflict originals.
- Very large imports can still exceed Cloud's existing request-size limit and remain local; no false remote-backup success is introduced.

## Files changed by this worker

Production:
- `src/lib/historyImport.ts` (new)
- `src/lib/legacyImport.ts`
- `src/lib/model.ts`
- `src/lib/sync.ts`
- `src/lib/cloudBoard.ts`
- `src/lib/ownership.ts`
- `src/lib/backup.ts`
- `src/lib/undoOps.ts`
- `src/components/LegacyImport.tsx`

Tests:
- `src/lib/legacyImport.test.ts`
- `src/lib/cloudBoard.test.ts`
- `src/lib/boardFields.test.ts`
- `src/lib/undoOps.test.ts`
- `src/components/LegacyImport.test.tsx`
- `src/lib/sweep.retention.test.ts` (new)
- `src/lib/ownership.importConsent.test.ts` (new)
- `src/lib/backup.recovery.test.ts` (new)

Documentation: this file.
