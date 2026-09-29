# Planned routing P5 durable recovery contract

Status: internally verified on the exact uncommitted P1–P5 plus approved UI
tree; ready for independent read-only review, not owner testing

## Exact product semantics

P5 does not add a general background queue. Each durable pending envelope has a
small local recovery record bound to its pending-row id, capture id, target id,
revision, exact semantic source, input source, and ordered image ids. Board,
tombstones, image bytes, and that record are accepted atomically at intake.

An automatic provider call is authorized at most twice for one exact pending
revision: the immediate post-save attempt and one recovery attempt no earlier
than 30 seconds later. The attempt is durably claimed before network work, so a
close, reload, timeout, or response that never observes AbortSignal cannot
restart it forever. Hydration and offline-to-online each inspect one finite
snapshot, oldest first, run at most three due captures serially, then stop.
There is no polling loop and no timer-driven retry chain.

The recovery record is deliberately device-local. A second device that receives
the pending Board row and its image bytes may use **Sort now** or manual filing,
but does not inherit authority for quiet automatic work. **Sort now** remains
available after automatic attempts are exhausted; every invocation is one
per-card 55-second attempt and never sets global `busy`.

Every automatic or explicit request is built from an immutable snapshot. Before
provider work, all referenced image bytes must exist and retain declared order.
Before persistence, the shared durable lane revalidates pending-row id,
capture id, target id, revision, source, input source, and ordered image ids.
Only that exact still-pending envelope may settle. Manual filing/splitting,
editing, deleting, prior settlement, or synced manual state makes a delayed
response stale. Stale responses are ignored without receipt, tab switch, Undo,
or classified output.

Provider timeout, offline state, malformed output, missing image bytes, and
failed settlement persistence retain the exact pending envelope and attachments.
Only the already-approved stable failure copy may be shown. Successful or
authoritatively retired envelopes remove their local retry record. Temporary
offline Threads remain display-only semantic context until rename.

## Acceptance matrix

1. Completely offline capture persists before composer clear, performs no
   provider work, remains manually fileable, and becomes eligible for one
   bounded online recovery attempt.
2. Provider timeout after local save leaves one exact pending envelope, releases
   per-card attempt state, and records the consumed attempt durably.
3. Reload restores several pending envelopes in Board order; recovery considers
   only the finite due snapshot and never globally blocks the app.
4. Manual sort or split before a delayed/restarted response wins; the response
   cannot create any second output or receipt.
5. Offline text plus ordered images survives reload. Recovery waits for every
   byte and sends all bytes in order before image-dependent settlement.
6. Retry success settles once. Replay, reload, a second click, and a stale
   response create no duplicate Action, Thread, fragment, Intention, or ledger
   settlement.
7. Malformed provider output consumes only the bounded attempt and leaves the
   exact envelope retryable by **Sort now**.
8. Cross-device merge carries pending text/provenance and image references;
   image reconciliation supplies bytes separately. Manual settlement received
   from either device defeats delayed local automatic finalization and cannot
   be overwritten or resurrect the retired pending envelope.
9. Composer, navigation, Settings, unrelated cards, and new durable captures
   remain usable while recovery work is in flight.

## Explicit non-goals

- no provider/model/copy change;
- no lexical or example-specific routing;
- no service, secret, Preview, deploy, or origin/main integration;
- no P6 real-provider or owner qualification;
- no broad always-on queue, service worker worker, hidden polling, or infinite
  retry path.

## Implemented boundary

- `pendingRecovery.ts` owns the strict persisted record schema, exact pending
  snapshot, two-attempt/30-second/three-per-wake limits, pruning, and claims.
- `pendingRecoveryOrchestrator.ts` owns the device-local finite wake. Hydration
  and `online` are its only triggers; it installs no timer or polling loop.
- Intake writes Board, tombstones, images, and recovery metadata together.
  Claims are persisted through the same durable lane before network work.
- Text recovery reuses planned routing. Image recovery loads every byte in
  order and reuses the existing image-aware explicit retry path. Both recheck
  the exact immutable pending snapshot inside finalization.
- Retry-aware manual, split, planned, and explicit settlements declare their
  exact pending row/revision and mechanically created artifacts. Sync uses that
  metadata only when the same slot has competing manual and automatic results:
  manual artifacts remain, stale automatic artifacts/receipts retire, earlier
  valid partial settlements remain, and repeated stale sync cannot resurrect
  the loser.
- Active routing authority now also lives in `Board.routingSettlements`, bounded
  by the lifetime of its governed artifacts rather than the 500-row history
  window. Planned automatic authority identities include the exact pending row,
  revision, and complete artifact coordinates, so concurrent valid plans remain
  distinct in either merge order and through ledger eviction. Persisted and
  synced authority is rejected or ignored unless its slot, revision, kind,
  coordinates, uniqueness, and at least one unambiguous live artifact are
  provable. Planned partial output includes its generated Unsorted remainder and
  pending ledger row in the same automatic slot.
- Manual winners also mint `Board.routingRetirements`: exact-slot tombstones with
  the same 30-day stale-device horizon as ordinary deletion tombstones. They
  survive deletion of the final manual artifact, history eviction, reload,
  backup restore, and live-authority pruning; seeing an actual stale loser
  refreshes the horizon. They compact after the horizon, do not govern a later
  revision, and never name unrelated artifacts.
- Startup recovery loading keeps parsed disk state until stale-record retirement
  itself persists. A failed `[]` write leaves the in-memory record retryable;
  the next explicit wake retries before provider work.
- Image reconciliation is part of aggregate sync success. Every referenced
  local image is remotely confirmed by HEAD or successful PUT, and every remote
  reference missing locally is fetched and stored before Settings can say
  synced. Over-envelope originals remain byte-exact in IndexedDB and report a
  truthful pending image status; the client will not attempt or claim an upload
  beyond the 2,250,000-byte Cloud security ceiling. New captures try bounded
  re-encoding even when dimensions are already small. `toBlob`, FileReader,
  conversion, drawing, null-output, and unexpected encoder failures all fall
  back to the selected original rather than omitting the attachment.

## Red to green and exact-tree evidence

- The pure policy suite first failed at missing-module load. Its final **6 / 6**
  tests cover exact identity, malformed metadata, limits/backoff, finite order,
  pruning, and final revalidation.
- Intake durability first failed **2 / 2** because no recovery record existed.
  Reload wake/image acceptance then failed **2 / 2** because no wake existed.
  The final hook file passes **79 / 79**, including offline capture, provider
  timeout, several-pending reload, delayed/manual race, offline ordered images,
  malformed exhaustion, explicit retry after exhaustion, and no duplicates.
- The latest independent-review blockers were each reproduced red before their
  fixes: **8 / 8** concurrent-plan order/cap cases left one automatic loser;
  **12 / 14** authority parser cases accepted unsafe records; unproven manual
  sync deleted a valid automatic artifact; both delete-after-win orders had no
  durable retirement; **5 / 16** encoder seam tests rejected instead of keeping
  original bytes; and the over-envelope sync test falsely accepted a PUT.
- Cross-device authority now passes **18 / 18** tests: both concurrent automatic
  merge orders, both later manual-winner orders, repeated stale A/B sync,
  history-cap eviction, partial/image cleanup, delete-after-win, persisted
  reload, retirement refresh/compaction, and revision-two non-interference.
- Persisted authority passes **19 / 19** direct parser tests plus **19** startup
  quarantine cases. Defensive sync ignores malformed, duplicate, ambiguous, or
  artifact-less manual authority and cannot use it to delete valid output.
- Image fallback passes **16 / 16** shrink tests, **23 / 23** image-sync tests,
  and the Capture integration proving the oversized original remains selected,
  is captured into the pending Board, and stays byte-exact in IndexedDB. The
  Settings pending-image copy remains unchanged.
- Consolidated blocker-focused gate: **10 files / 218 tests passed**. The
  source-only routing oracle remains **18 / 18**.
- Standalone TypeScript, touched-file ESLint, and `git diff --check` passed.
  Repository lint has only the pre-existing documented `restoreManualReceipt`
  hydration dependency warning.
- The exact tree passed the full canonical Vitest gate twice at **252 files /
  2,601 tests**. Next.js **16.3.3** production build passed with all **35** pages,
  and the trace guard passed **50 manifests** with no private paths.

No service, secret, provider, Preview, deploy, commit, push, merge, rebase,
reset, clean, stash, origin/main integration, or P6 work was performed. The
candidate is internally verified and ready for the requested independent
read-only review, not owner testing. Per owner direction, no further broad audit
loop is requested before the parent moves to isolated provider-enabled P6
qualification.