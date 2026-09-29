# Planned routing P4 common-path stabilization handoff

Status: the latest caption-sentinel and cross-device Action-owner blockers are repaired and fully source-verified on the exact uncommitted P1–P4 tree; **ready for another independent read-only review, not owner testing**

## Stabilized common path

- One durable Board transaction lane now owns local intake, planned/manual
  settlement, generic commits, pending edit/delete, Action completion, Undo,
  and sync pull/push adoption. React adopts only after Board+tombstone
  persistence succeeds.
- Undo and sync prepare from the lane's latest committed Board. A delayed
  manual write cannot overwrite either, and sync keeps Cloud tombstones.
- Generic mutations use an id-aware three-way rebase for unrelated entities.
  Same-entity conflicts return failure instead of acknowledging or replacing
  newer state. The queue does not await work that can re-enter it.
- Image bytes are retired only after the owning Board mutation commits.
  Storage failure while completing an image-backed Action leaves both the
  Action and image intact. Pending edit/delete return explicit success/failure,
  so the editor does not close on a failed save.
- P2 partial unresolved remainders remain manually fileable after the same
  capture has automatic settlement rows. Authorization is tied to the active
  pending row and revision; manual ids include that envelope identity, and
  earlier resolved outputs remain unchanged.
- Image-only and image-dependent captures do not enter planned routing without
  image semantics. They stay durably Unsorted with the existing stable failure
  copy and their bytes intact. Text-only planned routing is unchanged.
- Temporary offline-created Threads are display-only across Sort/planned
  authorization, Tidy, Recall, correction examples, recent/series context,
  summary sibling/refresh context, Daily Wrap, and Untangle. Rename removes the
  temporary marker and restores semantic eligibility.
- The exact 11-case owner-accepted R1 recovery pack remains a separate mandatory
  oracle beside the 12 planned-routing exercises. The recovery runner uses the
  legacy request shape; planned exercises retain their stronger destination,
  Action, deadline, duplicate, and malformed-response assertions.

## Final eight-blocker closeout

1. **Startup hydration and sweep:** `startupBoard.ts` loads and hydrates the
   Board and tombstones, sweeps it, then atomically persists Board+tombstones
   through the shared durable queue before React adoption or intake unlocks.
   Swept artifacts receive durable tombstones before the first sync.
2. **Durable transactions:** `durableBoardCommit.ts` serializes intake,
   settlement, generic mutations, Undo, and sync adoption against the latest
   committed state. Unrelated entity changes rebase; same-entity conflicts fail
   without a false acknowledgement.
3. **Undo:** `captureTransaction.ts` records the exact inverse ownership delta.
   Undo preserves synced same-ID edits and every non-owned or newer tombstone,
   and never revives a retired pending envelope.
4. **Discontiguous manual remainders:** manual routing authorizes the exact shown
   pending row by pending id, target, source, images, and revision. Multiple
   discontiguous remainders under one capture settle independently without
   disturbing siblings or automatic outputs.
5. **Explicit Sort now:** every referenced image byte is loaded and sent or the
   exact envelope remains pending. The request is hard-raced inside the
   55-second budget, owner-token authority lets manual filing abort/defeat it,
   and all exits release busy/attempt state.
6. **Commit acknowledgements:** Sort now, reviewed Intention save, single Tidy,
   Approve all, sync adoption, completion, and related receipt/dismissal paths
   acknowledge UI only after durable commit success. Failed conflicts keep the
   pending/draft/proposal state and expose no false receipt or Undo.
7. **Temporary Wrap/Untangle isolation:** temporary Thread identities, names,
   fragments, and associated ledger evidence are excluded from Daily Wrap and
   Untangle until rename; rename restores eligibility.
8. **Aggregate Undo learning:** every settlement row for the capture is
   aggregated before learning. Automatic Action+Thread outcomes become `both`
   and do not create a false single-kind correction; manual participation is
   never treated as rejected model evidence.

## Three-blocker independent-review repair

1. **Startup recovery now fails closed.** Confirmed key absence is the only
   first-run path. A transient Board read failure, malformed or invalid
   tombstones, or failed Board quarantine leaves the authoritative Board and
   tombstone bytes untouched, adopts nothing, keeps mutations disabled, and
   cannot pull or push sync state. Successful Board quarantine still preserves
   the exact unreadable source before replacement. The UI exposes only the
   existing stable recovery message.
2. **Slash-command payloads stay out of operational text.** Planned semantic
   requests, pending envelopes, manual Actions, Thread fragments, and
   Intentions use the payload returned by `command.ts`. The exact prefixed
   input remains in Record provenance and Undo restoration. `/action`,
   `/thread`, and `/intention` are covered online and through offline manual
   filing; ordinary text remains byte-for-byte unchanged. No semantic lexical
   rule was added.
3. **Explicit Sort now is background, per card.** Retrying a pending envelope
   no longer sets global `busy`, so the composer, navigation, and new durable
   intake remain usable. The retrying card alone disables retry/edit/delete;
   its manual filing controls remain available so manual authority can abort
   and defeat delayed AI. The existing 55-second hard race, owner token,
   all-image loading, truthful failure, and single-settlement protections are
   preserved, and card controls release on every exit.

## Preserved invariants

- Exact source, transcript/provenance, capture identity, timestamp, images,
  Record history, and Cloud tombstones survive failed or competing writes.
- Manual filing adds no lexical routing, prompt-specific repair, provider
  change, deployment, service access, or public-copy expansion.
- The protected daily local and Cloud deployments were not touched.

## Newest four-blocker common-path repair

1. **Complete persisted Board validation.** `persistedBoard.ts` now defines one
   complete Zod boundary for every current Board collection, row, enum, optional
   field, and nested object. Only explicit migrations remain optional: later
   collections and sync stamps, plus the already-supported partial legacy Action
   shape. Ledger rows must carry all required source/destination fields;
   correction rows must carry semantic `context` and valid nested routing. Bad
   state is adopted only after exact-byte quarantine succeeds; a failed
   quarantine still leaves the source Board and tombstones untouched.
2. **Truthful atomic finalization authority.** Automatic work must synchronously
   claim a per-capture commit phase inside the shared durable lane before IDB
   execution. A manual claim acquired first aborts automatic work and prevents
   any write. Once automatic finalization is claimed, manual claims fail and the
   card controls disable; timeout and a second retry cannot revoke or steal the
   commit phase. IDB `complete` is now treated as the commit fact: no post-commit
   guard can return failure or suppress React adoption after disk changed.
   Planned routing and explicit Sort now both use this seam. Failed manual
   persistence still releases its claim and leaves the exact pending envelope.
3. **Fail-closed image meaning.** Every capture carrying one to four images now
   requires one successful, non-blank interpretation per attachment. This is
   identical for one and many images: no missing vision tier, failed/null
   caption, whitespace caption, `"(image only)"` classification, or text-only
   fallback can reach the sorting model. Working one-image, image-only,
   text-plus-image, and ordered multi-image paths remain covered.
4. **Strict image data validation.** `sortImageDataUrl.ts` parses each image
   before provider work with canonical Base64 length/characters/padding,
   encoded and decoded size bounds, a fixed current-intake MIME allowlist
   (PNG, JPEG, WebP, GIF), and MIME-matching raster signatures. Empty, malformed,
   unsupported, arbitrary-byte, MIME-spoofed, oversized, and more-than-four
   requests receive the stable `{ error: "bad request" }` 400 response without
   any vision or sorting call.

## Exact final evidence

Verified on the exact uncommitted tree on branch
`feat/planned-routing-validation`:

- persisted-ledger/correction regressions first failed **4** assertions,
  including the downstream `context.trim()` crash. The final startup/current/
  legacy/quarantine slice passed **18 / 18** targeted assertions;
- atomic authority/durable unit regressions first failed **4 / 12**; planned and
  explicit-retry integration then failed **2 / 2** until both used the shared
  finalization claim. A further second-attempt race failed **1 / 1** before the
  active commit phase was made non-stealable. Manual-before-write, manual during
  commit, actual-IDB-write acknowledgement, failed manual persistence, reload
  equivalence, and timeout-during-commit now pass;
- one-image unavailable/null/whitespace regressions first failed **3 / 5**;
  image-only and text-plus-image success remain green without fallback;
- the strict parser test initially failed to load because the boundary did not
  exist; after its unit slice passed, route regressions still failed **4** cases
  (bad Base64 length, arbitrary bytes, MIME mismatch, decoded oversize) before
  route integration. The final real route/parser/caption slice passed
  **3 files / 44 tests**;
- consolidated focused blocker/regression gate: **8 files / 139 tests passed**;
- routing oracle source gate: **18 / 18 tests passed**, including the separate
  owner-accepted recovery matrix and planned-routing source assertions;
- `npx tsc --noEmit --incremental false` passed;
- touched-file ESLint passed with zero warnings;
- `git diff --check` and cached-diff check passed;
- full `npm run check`: lint passed; **240 files / 2,363 tests passed**;
  TypeScript passed; the Next.js 16.3.3 production build generated all 35
  static pages; trace guard passed across 50 manifests with no private paths.

The source is ready for an independent read-only review. It is not ready for
owner testing: no disposable Preview or real-provider qualification was run,
P4.2 remains separate, and this branch is still behind `origin/main` by five
commits as directed; history was not reconciled.

## Three-blocker follow-up repair

1. **Caption sentinels remain a mechanical integrity check.** Caption cleanup
   now removes only bounded whole-response wrappers and terminal punctuation
   before exact placeholder comparison. `No description available.`,
   `No caption available!`, `(image only).`, quoted `No caption`, and emphasized
   `Description unavailable` fail closed for every one-to-four-image request.
   Captions that merely contain those words remain valid; no substring or
   semantic routing rule was added.
2. **Image IDs remain immutable after durable intake.** When the composer keeps
   a same-ID/different-bytes edit while the original attachment transaction is
   in flight, reconciliation remints the edited attachment before it can be
   submitted again. The first pending capture and its final owner retain the
   original ID and bytes; the second capture receives a distinct ID and bytes;
   repeated explicit retries create neither duplicate.
3. **Manual Action image owners follow ordinary board operations.** Fragment
   move and split and whole-Thread merge repoint every matching `Action.shot`.
   Fragment or Thread deletion fails while a current Action points at that
   owner. Once the Action is completed, deletion may proceed, but image cleanup
   filters candidates against every current Board reference and immutable
   ledger row. Rendered picture links, completion, reload, stale-device sync,
   and complete backup behavior are covered for move, split, merge, fragment
   delete, and Thread delete.

### Follow-up red-to-green evidence

- Caption unit/route regressions first failed **25 assertions**. The final
  caption/route slice passed **2 files / 74 tests**.
- Image-identity helper and delayed-write/second-submission integration first
  failed **2 assertions**. The final intake slice passed **2 files / 70 tests**.
- Owner lifecycle pure regressions first failed **6 assertions**; the rendered
  lifecycle suite then failed **5 / 5**, and the immutable-reference helper
  failed **1 / 21**, before integration. The consolidated owner slice passed
  **4 files / 78 tests**.
- Consolidated focused routing, intake, settlement, owner, sync, backup, and
  completion gate passed **13 files / 272 tests**.
- The source-only routing oracle passed **18 / 18**; TypeScript and touched-file
  ESLint passed with zero warnings. `git diff --check` and cached-diff check
  passed.
- The first canonical check hit one isolated timing-threshold failure in
  `organize.performance.test.ts` (`36.8 ms` versus the `20 ms` single-tick
  budget). Its immediate focused rerun passed **3 / 3**; the complete canonical
  rerun then passed lint, **241 files / 2,420 tests**, TypeScript, the Next.js
  16.3.3 production build with all **35** pages, and the **50-manifest** trace
  guard with no private paths.

## Latest two-blocker independent-review repair

1. **Whole-response caption sentinels cover ordinary terminal decoration.**
   Bounded normalization now removes terminal commas, colons, semicolons,
   em/en/hyphen dashes, and nested ordinary quote/paren/emphasis wrappers before
   exact sentinel comparison. Every one-to-four-image route fails closed when
   any caption is only a decorated placeholder. Descriptive captions that
   contain the same phrases still pass unchanged; no substring or semantic
   routing rule was added.
2. **Cross-device Action image pointers reconcile to fragment identity.** After
   structural Thread merge and Action LWW, each live `Action.shot` is repointed
   only when its `fragId` has exactly one current Thread home. A missing or
   ambiguous home preserves the original pointer rather than guessing; deletion
   guards independently protect every live referenced `fragId`, so stale or
   ambiguous Thread ids cannot expose owner fragments or Threads for deletion.
   The repair preserves Action/fragment timestamps, immutable ledger rows, image
   ids and bytes, and completed legacy Actions. The board signature now includes
   shot coordinates so a timestamp-preserving reconciliation is adopted by the
   sync pull path. Move, split, and whole-Thread merge converge in either merge
   order, and the reconciled rendered picture link remains deletion-protected.

### Latest red-to-green evidence

- Caption regressions first failed **35 assertions**: **7** direct normalization
  cases and the same seven variants across every one-to-four-image route
  (**28** route cases). The final caption/route slice passed **2 files / 112
  tests**.
- Move, split, and whole-Thread stale-device sync regressions plus missing and
  ambiguous-home behavior first failed **5 / 33**. Stale/ambiguous owner
  deletion protection then failed **2 / 26**. A live-only reconciliation guard
  failed **1 / 34**, and the timestamp-preserving adoption signature failed
  **1 / 35**, before their respective fixes.
- The final focused normalization, route, order-independent sync, owner lifecycle,
  rendered link, deletion, ledger, image-byte, and timestamp gate passed **5
  files / 179 tests**.
- The source-only routing oracle passed **18 / 18**; standalone TypeScript and
  touched-file ESLint passed with zero warnings; `git diff --check` and the
  cached-diff check passed.
- Final `npm run check` passed: repository lint; **241 files / 2,468 tests**;
  TypeScript; Next.js 16.3.3 production build with all **35** pages; and the
  **50-manifest** trace guard with no private paths.

The exact uncommitted source is ready for independent review, not owner testing.
No service, secret, provider, Preview, deploy, commit, push, merge, rebase,
reset, clean, stash, P4.2, or P5 work was performed. The branch remains five
commits behind `origin/main` by instruction.

## Exact `origin/main` integration handoff — do not integrate yet

- Current branch base/HEAD is `381b1146be441a425fcf03a28ef030470e5a4b3c`.
  Local `origin/main` is `7a5c13d40d49eb1da4cfed0b0e675bafce5cead1`,
  exactly **5 commits ahead**. No fetch, merge, rebase, cherry-pick, reset,
  stash, commit, push, or worktree operation was performed.
- A read-only three-way simulation used that common base plus the current
  uncommitted files. Four paths are changed on both sides:
  `src/app/Capture.tsx`, `src/app/globals.css`,
  `src/hooks/useBoard.accountIsolation.test.ts`, and `src/hooks/useBoard.ts`.
  The first three merge without textual conflict. `useBoard.ts` has exactly
  **4 conflict regions**:
  1. the helper seam immediately after `count`, where this branch adds
     `createHydrationGate` and main removes surrounding blank lines;
  2. explicit pending **Sort now** settlement, where this branch owns the
     durable transaction/finalization path and main adds structured
     `landedLines` receipt propagation;
  3. the durable intake transaction beginning at
     `stagePlannedRoutingIntake`, overlapping main's deletion of the legacy
     blocking submit path and its `landedLines` additions;
  4. the end of that durable intake transaction (`pendingBoard`/image entries/
     failure handling), overlapping main's structured-receipt edits to the
     removed legacy submit implementation.
- Resolution rule: preserve this branch's hydration gate, durable intake,
  finalization claims, composer image reminting, and owner-aware mutation/image
  cleanup. Port main's `receiptLines`/`landedLines` state and calls into the
  durable result seams; port its backup-restore notice imports and error/success
  handling independently. Do **not** resurrect the legacy blocking submit or
  pre-transaction explicit-resort code shown on the base side of conflicts 2–4.
  After resolution, rerun the 272-test focused gate, 18 routing oracles,
  TypeScript, touched lint, `git diff --check`, and full `npm run check`.

## P4.2 manual split implemented

The exact interaction and safety contract are fixed in
`specs/planned-routing-p4.2-manual-split.md`. `Split manually` opens a local,
user-authored editor; it performs no model or lexical splitting. The person may
add, edit, reorder, remove, and explicitly file segments as Action, Intention,
existing/new Thread, or Pending. Saving is enabled only when canonical
source-order concatenation is byte-for-byte equal to the pending source.

All attachments remain exactly once on the original pending envelope, which
becomes image-only after a successful text split. No text segment receives an
inferred image owner. The complete split uses the shared capture authority and
durable transaction lane; cancellation and failed persistence change nothing,
and deterministic identities make retry/reload/sync idempotent.

P4.2 red-to-green evidence: the pure suite first failed at missing-module load;
the rendered suite then failed 3 accessibility/interaction cases; hook tests
failed until the operation was wired through capture authority and persistence.
The final focused P4.2/manual/ratchet gate passed 5 files / 118 tests; isolated
sync passed 6/6 and the performance boundary 3/3; routing oracles passed 18/18;
TypeScript, touched lint, diff checks, production build (35 pages), and trace
guard (50 manifests) passed.

The attempted full `npm run check` completed repository lint and 237 files /
2,480 tests before a resource-starved run timed out workers and exposed the
`useBoard.ts` line ratchet. The ratchet was repaired by moving the shared manual
operation protocol into `manualRoutingOperations.ts`; every named failed suite
then passed in isolation. The full suite was not repeated after its 40-minute
resource stall.

Do not start P5 from this handoff. Do not label the branch owner-test ready from
source gates alone.

## Post-sync Action-shot topology blocker repair

Status: repaired on the exact uncommitted P1–P4 tree; ready for another
independent read-only review, not owner testing.

- `mergeSync` now filters both boards through the merged tombstones before
  topology reconciliation. A fragment or Thread tombstone can therefore leave
  zero homes, or expose a different unique surviving home, before any
  `Action.shot` coordinate is considered.
- Fragment LWW still resolves a genuinely newer copy. Distinct maximal copies
  with the same timestamp are retained in their original homes instead of
  being collapsed into invented uniqueness. Exact copies coalesce. This
  propagates ambiguity through subsequent syncs, preserves conflicting content
  and image references, and removes argument-order dependence from the
  conflict set.
- Live Actions are repointed only when the final maximal topology has exactly
  one plausible Thread home. Zero or multiple homes preserve the complete
  original Action, including its timestamp and shot. Completed Actions remain
  untouched; append-only ledger rows and image ids are not rewritten.
- `boardSignature` continues to expose a valid timestamp-preserving shot repair,
  while an ambiguous merge produces no false shot-only adoption signal.
- Integration coverage now runs through `mergeSync` for duplicate homes within
  one input and across both inputs, both argument orders, equal-timestamp
  conflicting content/images, ambiguity propagation into later syncs, fragment
  and Thread tombstones, unique final-home recovery, exact fail-closed metadata,
  and the existing move/split/whole-Thread-merge repairs.

### Post-sync red-to-green evidence

- The first within-input duplicate-home regression failed with the shot changed
  from `original-home` to `one`; it passed after reconciliation stopped using
  the prematurely collapsed topology.
- The cross-input equal-timestamp regression then failed because forward merge
  kept `one`/left content while reverse merge kept `two`/right content.
- The follow-on propagation regression failed because a second sync collapsed
  the evidence and rewrote the shot to `one`. Retaining all distinct maximal
  conflict copies made both regressions green without dropping either image.
- Final sync integration file: **42 / 42 tests passed**.
- Focused sync/owner/durable regression gate: **6 files / 105 tests passed**.
- Routing oracle source gate: **18 / 18 tests passed**.
- Standalone TypeScript, touched-file ESLint, `git diff --check`, and cached-diff
  check passed.
- Full `npm run check` passed: repository lint; **241 files / 2,475 tests**;
  TypeScript; Next.js 16.3.3 production build with all **35** pages; and the
  **50-manifest** trace guard with no private paths.

No service, secret, provider, Preview, deploy, commit, push, merge, rebase,
reset, clean, stash, P4.2, or P5 work was performed. Branch HEAD remains
`381b114`; local `origin/main` is `541a711`, exactly **7 commits ahead**. The
uncommitted source is ready for independent review.

## P4.2 two-blocker identity/idempotency repair

Status: internally source-verified on the exact uncommitted P1–P4.2 tree;
ready for another independent read-only review, not owner testing.

1. **The editor now owns one immutable pending snapshot.** Opening manual split
   captures the exact pending-row id, capture id, target id, source, ordered
   image ids, input source, and revision. That snapshot crosses the rendered
   callback and `manualRoutingOperations` unchanged, supplies the authority
   capture id, and is revalidated inside the durable transaction. Settlement
   requires exactly one active row targeting the envelope and exact row plus
   envelope state. Changed/reordered attachments, replaced row/capture identity,
   stale target/source/revision, and duplicate target rows fail as
   `pending_mismatch` without a Board write. A shown-card/snapshot target mix-up
   is rejected before authority is claimed.
2. **Only explicit partial remainders may settle after classified output.** If
   the capture has an active classified row, the exact selected pending row must
   carry `partial: true`. A stale non-partial row cannot create a second
   settlement. The valid discontiguous path still settles only the selected
   partial row; sibling partial rows and earlier automatic outputs remain
   byte-for-byte untouched. Replay and duplicate target state fail closed.

### Red-to-green and final evidence

- The first exact-snapshot pure run failed **6 / 25** tests: changed attachments,
  reordered attachments, replaced capture identity, replaced pending-row
  identity, duplicate active target rows, and classified-plus-stale-non-partial.
  The final pure file passed **25 / 25**.
- The rendered editor-snapshot regression failed **1 / 17** because only the
  Action and segments crossed the callback; it passed after the editor-open
  snapshot became the third argument.
- The operation identity regression failed **1 / 1** by settling snapshot A
  while shown card B was supplied; it passed after exact target admission.
- Consolidated P4.2/common-path gate: **9 files / 188 tests passed**.
- Routing oracle source gate: **18 / 18 tests passed**.
- Standalone TypeScript, touched-file ESLint, `git diff --check`, and cached-diff
  check passed.
- Full `npm run check` passed: repository lint; **243 files / 2,508 tests**;
  TypeScript; Next.js 16.3.3 production build with all **35** pages; and the
  **50-manifest** trace guard with no private paths.

No service, secret, provider, Preview, deploy, commit, push, merge, rebase,
reset, clean, stash, origin/main integration, or P5 work was performed. The
exact uncommitted source is ready for another independent read-only review, not
owner testing.
