# Capture launch closeout

Source-lane closeout snapshot verified against `release/capture-launch-closeout` at base `a1f36862b3a0ec0a911754bb02d193e43f7dcf85`; second closeout pass updated 2026-09-20 00:21 +07. The release-candidate integration subsequently adds the separately verified OpenRouter/Jev and Search-that-answers lanes; `docs/integration-manifest-2026-09-20.md` is authoritative for the combined tree and its verification.

This is a current-state reconciliation, not a deployment or release approval. Historical checklists are evidence inputs, not current truth. No worktree was reset, cleaned, stashed, committed, merged, rebased, pushed, deployed, or migrated. No environment or secret values were read.

## Executive state

- Current `origin/main` already contains the public landing, motion, playground, Cloud foundation, OTP, subscriptions, ownership boundaries, persistent offline permission, explicit earlier-board import, billing hardening, and the default-closed durable image-publication protocol.
- The source suite was green before closeout edits: 186 files / 1,748 tests. The merged launch source now passes 227 files / 2,191 tests, including the launch, OpenRouter/Jev, Search-that-answers, truthful provider-status, explicit-task, minimal answer-surface, navigation-deduplication, offline waiting-to-sort, complete Cloud backup v3, operational-retention, account-erasure, and complimentary-access regressions. The hosted-source gate passes 41 files / 474 tests.
- One launch-relevant branch-only fix was not on `origin/main`: uncapping explicit tasks in Sort and Distill. It has been integrated into this closeout working tree without changing its preserved source branch. Tests were adapted for current `primaryActions` and sanitized-provider interfaces.
- The lockfile resolved four development-tool advisories (two moderate, two high) by moving to fixed in-range transitive versions. Earlier full and production audits returned zero. The second-pass audit is **indeterminate**, not failed-security evidence: npm's audit services were under scheduled maintenance and both supported audit endpoints failed before returning advisory data.
- No other dirty-worktree artifact is a safe launch port. The remaining manual acceptance is consolidated into exactly two owner sessions below. A local-only hosted source gate now removes the synthetic unit/SQL/browser-simulator work from Session A.
- The combined candidate was deployed to the isolated `capture-playground` Preview on 2026-09-20. OTP authentication, Cloud identity/subscription readback, hosted sync through the app, a real cited answer, and all three non-authoritative Jev shadows completed with synthetic non-sensitive text. Retake passed the hosted two-scene answer flow at 1920×1080. Two distinct authenticated sandbox accounts then passed owner-precondition isolation; the second account passed free denial, Polar sandbox monthly checkout, signed-webhook entitlement readback, customer-portal access, and scheduled cancellation while retaining access through its future period end. This narrows Session A but does not replace terminal expiry/revocation, duplicate/reconciliation provider scenarios, hosted Storage races, or physical-device acceptance.

## Current implemented / partial / absent matrix

`Implemented` means present in the current source and covered by current tests. It does not mean deployed or owner-accepted. `Partial` identifies the exact missing evidence or boundary. `Absent` means current source does not implement it.

| Launch area | State | Current evidence | Disposition |
| --- | --- | --- | --- |
| Typed Capture, Actions / Threads / Intentions / both | Implemented | Current routes, hook, board operations, ledger, Undo, and 1,748-test baseline | Keep; do not rebuild. |
| Multi-subject splitting and action-to-thread scoping | Implemented | Current `also`, `primaryText`, `primaryActions`, route and hook tests | Keep; historical proposals to add basic splitting are stale. |
| Preserve every explicit task | Implemented and accepted with a real provider on Preview | Red prompt contract on current main, then 2 files / 8 tests green after three prompt-line changes; hosted Cerebras Sort, forced-action Sort, and Distill each preserved the same four synthetic explicit tasks without invention | Retain this closeout diff; treat the hosted fixture as bounded compliance evidence rather than a universal language guarantee. |
| Failed-provider capture preservation | Implemented and accepted in an isolated local browser run | Failed-sort settlement stores unsorted input; provider retries are disabled per call; source tests cover recovery. An isolated run with every provider key intentionally invalid returned 503 after exhausting all configured tiers, saved the exact synthetic capture as unsorted, preserved it through reload, and left the composer usable | Complete for launch-source acceptance; provider outages still remain an operational condition to monitor. |
| Offline/provider-failure waiting-to-sort flow | Implemented in release candidate | Lossless unsorted envelopes are excluded from normal Actions, counts, shares, Tidy, summaries, and automatic Recall disclosure; a compact horizontal **Waiting to sort** strip appears above Search with an online-only Sort action. Retry preserves exact text/images on failure and removes the envelope only after successful action/thread/both/intention settlement. Exact-owner paid entitlement is cached only for offline use and invalidates at its server-verified expiry | Source and automated behavior are complete; physical installed-PWA rendering, airplane-mode continuity, reconnect Sort, and photo readback remain in Session B. |
| Keyword Search | Implemented | `SearchResults.tsx` remains immediate and local in the release candidate | Preserve as the fail-safe baseline through answer loading and failure. |
| Cited answer Search | Implemented in release candidate | The integrated Search lane automatically answers precision-detected stable questions above unchanged local matches, with a visually quiet wait, a minimal answer plus connected-item controls, bounded evidence, deduplication, cancellation, and citation validation | Local source is complete; deployed and owner acceptance remain separate. |
| Public playground | Implemented in source | Public `/app`, local board, 15-capture allowance, Cloud/sync/image/transcribe/TTS/report closure, source tests | Deployed stranger and mobile checks remain manual. |
| Playground rate limiting and human 429 copy | Partial | All model routes use the shared in-memory per-IP limiter; TTS/transcribe have separate buckets; UI rewrites model 429s in playground mode | Historical PH target of distinct 20/10m and 15/10m buckets is not the current implementation, and in-memory serverless limits are not a hard global spike ceiling. Do not retune without runtime data/approval. |
| Provider spend ceiling | Absent from source by design | Provider dashboard control, not an app primitive | Owner must configure/read back the provider limit. |
| Landing, pricing, login, install, writing, SEO, navigation, motion | Implemented | Current `origin/main` contains the later content and motion commits; source tests cover public surfaces | Landing is explicitly complete in the approved Sep 15 queue. Preserve public copy. |
| Product Hunt copy/assets/status bundle | Absent / stale scope | `docs/product-hunt-launch-brief.md` has no populated Status and `docs/ph/` is absent; it also predates pricing/Cloud decisions | Do not generate or publish copy without approval. Prepare only if Product Hunt is reconfirmed. |
| Cloud OTP sign-in | Implemented in source | `CloudLoginForm`, Supabase SSR boundary, CSP/proxy tests | Real email delivery and clean-session login remain manual. |
| Cloud board ownership and tenant derivation | Implemented and accepted at the hosted request boundary | Verified-claim identity, `X-Capture-Owner`, per-owner repository access, fail-closed boundaries, account-isolation tests; two distinct deployed accounts each read their own board while both swapped-owner requests returned 412 and both missing-owner requests returned 428 | Content and image isolation still need the hosted Storage campaign; the authenticated board route itself is accepted. |
| Cloud board merge and optimistic writes | Implemented in source | Current `cloudBoard.ts` merges server state, retries compare-and-swap, acknowledges imported history atomically | Real concurrent devices and hosted PostgREST remain manual. |
| Cloud local/offline continuity | Implemented in source | Explicit until-revoked device grant, cached generic shell, offline edit/reconnect path, fake-IDB and isolated Chromium evidence | Physical installed-PWA airplane mode, browser eviction, remote revocation, and second-device recovery remain manual. |
| Earlier local board import | Implemented in source | Consent gate, deterministic ID rewrite, full snapshot, photo copy, import receipts, archive download, Undo/board-field guards | Live account import and second-device recovery remain manual. Previously completed pre-fix imports are not blindly repaired. |
| Capture Cloud plans and local allowance | Implemented in source | Signed-out/free uses 15/day; entitled Cloud is unlimited; self-hosted is unlimited; failure defaults public Cloud to 15 | Verify against the deployed subscription route. |
| Polar checkout, portal, signed webhooks, lifecycle | Implemented; core sandbox path accepted | Safe continuation, server-owned plan, signed webhook processing, durable equal-timestamp reconciliation, past-due anchor, disposable PostgreSQL tests; a free second account received 402 for its board, completed a verified `sandbox.polar.sh` monthly checkout, became active Cloud, opened its sandbox customer portal, scheduled cancellation, and read back canceled/monthly/cancel-at-period-end with future access | Terminal expiry/revocation, past-due timing, duplicate delivery, and reconciliation retry remain provider-side acceptance gaps. |
| Checkout success messaging | Implemented | UI grants only after server-confirmed subscription state; URL parameter alone does not grant access | Sandbox browser acceptance remains manual. |
| Cloud image validation, tenant paths, and physical quota | Implemented in source, hosted attestation blocked | MIME/signature/size checks, exact owner/lifecycle/entitlement, database-generated candidate paths, atomic 256-object/576-MB reservation defaults, service-only finalize/release/abandon, durable operation inventory, no-store responses | Product must approve/change the internal defaults by migration. Hosted direct-INSERT denial, service upload, and provider quiescence/inventory remain launch gates. |
| Durable immutable image publication | Partial, safely default-closed | Fresh UUID candidates, digest-bound publication, unique-key arbitration, stable winner-byte validation, mode/bucket plus admission RPC gates, fresh/legacy upgrade tests | No activation until approved hosted namespace provenance, post-admission policy attestation, and five race rounds pass. Legacy cutover remains blocked on provider drain and preservation evidence. |
| Account erasure | Source state machine and bounded worker implemented; default-off | Durable lifecycle fence, live-user/recent-email-OTP/session-bound receipt, provider admissions/capabilities, leased one-stage retries, image ledger plus Storage inventory, app/Auth readback contracts | Hosted stale-JWT fence authority, Storage quiescence/inventory, OTP claims, Polar capability/errors, Auth typed absence, grants, UI/copy/legal and owner acceptance remain mandatory before setting the three activation flags. |
| Cloud export and restore | Implemented in source; hosted acceptance pending | Owner-bound backup v3 reads authoritative Cloud state, includes tombstones and pending recovery envelopes, recovers and verifies every referenced image, restores additively, and retains v1/v2 compatibility | Apply hosted migrations, then prove a clean-browser exact-owner export/restore with remotely held image bytes and a transfer above the ordinary image request ceiling. |
| Cloud value metrics and per-user quotas | Quotas implemented; analytics still partial | Durable server-owned AI/board/backup request quotas plus atomic image object/byte reservations; playground still has bounded aggregate usage events | Approve image product limits and retain private policy ownership. Do not add analytics without a privacy and operations decision. |
| PWA freshness | Implemented in source | Service worker v3 and `FreshBuild`/`/api/version` support exist | Installed-device double-reload and visible-build comparison remain manual. |
| Backups / restore / selected-day and selected-thread share | Implemented in source | Complete owner-bound backup v3, additive restore, selected-day isolation, thread export, and whole-board Settings action are tested | Hosted remote-image recovery and native receiver behavior remain manual. |
| Natural-language multi-thread filing commands | Absent, not a launch gate | Explicitly deferred in the Sep 15 priority record | Do not propose for launch closeout. |
| Shared threads / collaboration / general agent mode / graph UI | Absent, intentionally deferred | Product records classify these as later experiments; general chat and graph UI conflict with current boundaries | Do not build for launch. |

## Repository inventory

The base repository contains 509 tracked files: 287 `.ts`, 81 `.tsx`, 39 `.md`, 19 `.mjs`, 12 `.sql`, plus configuration, tests, media, and scripts. Base `origin/main` has 186 test files; this closeout adds two test files for a final 188. The launch-relevant source is concentrated in:

- `src/app` and `src/components`: public pages, Capture UI, login, billing, ownership, offline/import surfaces.
- `src/hooks`: board coordination, Cloud/offline sync, capture-limit and media behavior.
- `src/lib`: pure board, ownership, billing, publication, backup, search, and provider policies.
- `supabase`: historical and additive Cloud, billing, and image-publication migrations plus verification templates.
- `scripts`: local probes, disposable PostgreSQL checks, preview verification, and setup tools.
- `docs`: historical launch brief, current Cloud evidence, data flow, architecture, and acceptance boundaries.

Repository documents disagree in time:

- `docs/product-hunt-launch-brief.md` says no accounts/pricing and predates current Cloud.
- `VISION.md` still says no account/cloud, but current source and pricing implement optional Cloud.
- `specs/capture-built-status.md` is dated 2026-08-06 and incorrectly lists later-shipped items as unbuilt.
- `docs/cited-search-acceptance.md` now describes the integrated release-candidate Search-that-answers behavior restored after `a1f3686`.
- The untracked `Capture-cloud/docs/capture-priorities-2026-09-15.md` is the newest explicit priority record: landing complete; natural-language filing and collaboration not launch gates; Cloud, device, billing, release and fresh-visitor acceptance remain open.

These are documentation provenance issues, not permission to rewrite public copy during closeout.

## Worktree disposition

Git registers 17 worktrees: 10 exist and 7 are stale/prunable registrations. Six existing worktrees are dirty. Every dirty path was inventoried; no file was removed or moved.

| Worktree | HEAD / state | Unique work and disposition |
| --- | --- | --- |
| `/Users/glebbogachev/Documents/capture` | local `main` at `4ff65e8`, 19 behind, dirty | Old responsive demo assets/code; explicit-task prompt/tests; generated Retake type paths; agent/FOT/video/outreach notes. The explicit-task intent is represented by `a13526b` and integrated into closeout on the current base. Demo assets are also present in `Capture-clarity` and conflict with later landing decisions; preserve, do not port. Notes remain standalone historical/procedural records. |
| `/private/tmp/capture-launch-audit-CdsdFf` | detached `a1f3686`, clean | Exact clean audit copy of current `origin/main`; no unique work. |
| `/Users/glebbogachev/Documents/Capture-clarity` | `4ff65e8`, 19 behind, dirty | Earlier landing-copy redesign, headline/metadata experiment, brand assets, responsive demo assets, and an illustrative idea-over-time recording harness. Later committed landing content/motion supersedes the page work; the recording is explicitly an internal candidate awaiting full-motion review. Do not port or publish. |
| `/Users/glebbogachev/Documents/Capture-cloud` | `f80ddb6`, 9 behind, dirty | Committed Cloud work is already in `origin/main`. Dirty work is backlog/priority/draft documentation, generated type paths, broken temporary `/tmp` acceptance symlinks, a copied image acceptance page, and a localhost-only sandbox RLS route. Use the priority doc as evidence. Never ship the temporary route or public harness. Preserve broken symlink records. `.temp` metadata was inventoried by path/hash only and not read. |
| `/Users/glebbogachev/Documents/Capture-content-release` | `5edb367`, clean | Fully contained in `origin/main`; no unique work. |
| `/Users/glebbogachev/Documents/Capture-explicit-tasks-release` | `a13526b`, clean | One branch-only commit: preserve every explicit task. Focused branch run passed 2 files / 8 tests. Closeout now carries a current-base manual integration with necessary schema/mock adaptations. Keep the source branch untouched until release disposition. |
| `/Users/glebbogachev/Documents/Capture-launch-closeout` | `a1f3686`, dirty source lane | Lockfile advisory fixes, current-base explicit-task fix/tests, hosted source gate, and this matrix. The source worktree remains untouched by release-candidate integration. |
| `/Users/glebbogachev/Documents/Capture-motion-preview` | `d0fee70`, 3 behind, dirty | Committed motion is already in main. Dirty files are generated type paths and local verification scripts/evidence plumbing; no product source. Preserve, do not port. |
| `/Users/glebbogachev/Documents/Capture-openrouter-launch` | `a1f3686`, dirty source lane | Provider preference, OpenRouter setup wizard, docs/config/tests, and disabled-by-default Jev thread/judge/Recall shadows. Integrated into the release candidate without changing this source worktree; real funded-provider and privacy-routing checks remain manual. |
| `/Users/glebbogachev/Documents/Capture-seo-usage` | `2eb5b89`, clean | Fully contained in `origin/main`; no unique work. |

Stale registrations, preserved and not pruned:

- `/private/tmp/capture-integration-20260916` at `87e76be`
- `/private/tmp/capture-layout-release` at `c1b0a9c`
- `/private/tmp/capture-live-alignment` at `e53f3b9`
- `/private/tmp/capture-push-verify-20260916` at `c1b0a9c`
- `/private/tmp/capture-release-personal-20260916` at `87e76be`
- `/private/tmp/capture-release-playground-20260916` at `87e76be`
- `/private/tmp/capture-search-rollback-20260916` at `a1f3686`

## Branch disposition

There are 16 local branches and 13 cached `origin/*` branches.

### Current or launch-specific branches

| Branch | Relation to `origin/main` | Disposition |
| --- | --- | --- |
| `origin/main`, `release/capture-launch-closeout`, `fix/restore-original-search-20260916`, `feat/openrouter-launch-setup` | At `a1f3686` before working changes | Current baseline or current-base worktree anchors. |
| `fix/preserve-explicit-capture-tasks` / remote | 1 unique commit, 5 behind | Source-only launch fix integrated manually into closeout; branch preserved. Do not merge the stale base wholesale. |
| `integration/capture-cloud-main-20260916` / remote | 1 behind, no unique commits | Historical merge point; fully contained. |
| `feat/capture-cloud-polar` / remote | 9 behind, no unique commits | Cloud source already contained in main. Dirty worktree artifacts are separate and uncommitted. |
| `feat/capture-cloud-foundation` | 16 behind; remote foundation ref 17 behind | Historical Cloud slices, fully contained. |
| `feat/capture-landing-motion` / remote | 3 behind, no unique commits | Motion is contained in main. |
| `feat/landing-content-release` | 5 behind, no unique commits | Content release is contained in main. |
| `feat/playground-usage-seo` / remote | 18 behind, no unique commits | Contained in main. |
| `fix/live-alignment-20260912` / remote | 17 behind, no unique commits | Contained in main. |
| `feat/capture-message-clarity` and local `main` | 19 behind, no committed unique commits | Their important work exists only as dirty files described above. |

### Divergent historical branches

| Branch | Unique work | Disposition |
| --- | --- | --- |
| `design-language` | Five unique `/v2` prototype commits; two later bug-fix commits are patch-equivalent to main | Old parallel UI prototype, 126 commits behind. Not launch scope; do not port. The action-association/photo-caption fixes are already in main. |
| `codex/capture-distill-merge-repairs` / remote | One unique commit, 301 behind | Historical bundle mixing Distill authorship rules with reversible thread-fold state and sync changes. Current main evolved substantially and whole-thread restructuring is not a launch item. Preserve; do not cherry-pick or manually port. |

### Fully contained remote history

`origin/bug-sweep`, `origin/capture-sandbox`, `origin/preview/suite`, and `origin/vercel-storage` have no commits ahead of current main. Their names do not indicate missing launch work.

## Dirty artifact deduplication

- Responsive `two-places-mobile` media and `LandingDemo` edits are byte-identical in dirty local main and `Capture-clarity`; they are one duplicated candidate, not two tasks.
- Dirty local-main explicit-task work and commit `a13526b` express the same change. `a13526b` is the current clean preservation point; closeout integrates it on the latest base.
- Motion product source is committed and in main. Untracked motion scripts are verification harnesses, not another feature implementation.
- Cloud public acceptance files under `Capture-cloud/public` are temporary or broken symlink copies. The tracked authoritative fixture is `scripts/fixtures/sandbox-image-publication-acceptance.*` on current main.
- The earlier clarity landing and later committed landing sequence are not additive. The later commits and explicit “landing complete” decision win.
- Cited Search is user-accessible again only in the combined release candidate. Its local acceptance document is source evidence, not deployment evidence.

## Safe source-only closeout completed

1. Integrated the explicit-task prompt contract from the preserved branch onto current main without merging its stale base.
   - RED on current main: 3 prompt tests failed because Sort and Distill still imposed a one-to-three task cap.
   - GREEN: the current Sort normal path, forced-action path, and Distill settlement request every distinct explicit/agreed task while retaining anti-invention and clause-cohesion rules.
   - Component coverage proves four provider-returned actions survive the real hook, visible board, IndexedDB, and reload. Fixtures do not claim live-model compliance.
2. Updated only lockfile-resolved development tooling within existing semver ranges.
   - `vitest` / `@vitest/mocker`: 4.1.10 → 4.1.11.
   - vulnerable `brace-expansion` resolutions: 1.1.16 → 1.1.21 and 5.0.8 → 5.0.12.
   - `js-yaml`: 4.3.0 → 4.3.2.
   - `npm audit --audit-level=high`: zero vulnerabilities after the update.
3. Made the canonical check deterministic on the shared Mac.
   - RED: the prior unbounded `npm run check` passed 1,754 tests but timed out one ownership test and measured the real-hook performance case at 706 ms against its 500 ms limit under worker contention.
   - A later two-worker run also hit the pinned organizer-performance boundary while the host was under load. The affected performance and ownership files passed with one worker, and the complete one-worker suite passed.
   - `npm run check` now invokes Vitest with `--maxWorkers=1`; no timeout or performance assertion was weakened. The complete canonical check then passed.
4. Removed the stale unused `Frag` type import. Canonical lint now exits with zero warnings as well as zero errors.
5. Removed a billing component-test race exposed by the serialized gate. The test now waits for retry-status busy state to clear before clicking **Manage subscription**, matching real button behavior. The focused billing file passed all 10 tests; no product code changed for this correction.
6. Added and executed `npm run check:launch-hosted`, a local-only preflight that runs the focused tenant/auth/billing/storage suite, both disposable image-publication SQL modes, disposable billing SQL, and the synthetic five-round browser client. It passed 20 Vitest files / 245 tests, both SQL modes, billing SQL, and all browser-client positive/negative scenarios. It does not load environment files, contact Supabase/Polar, deploy, or mutate hosted data.
7. Closed the physical-PWA issues discovered during owner testing without changing the persisted board model.
   - Offline/provider-failed captures remain lossless storage envelopes but no longer masquerade as ordinary Actions or inflate Action counts.
   - The minimal **Waiting to sort** strip appears above Search; retry is explicit, online-only, double-submit guarded, and keeps the envelope until settlement succeeds.
   - Unsorted material is excluded from summaries, automatic cited Recall, normal Action Search/shares, thread-derived Actions, and Tidy/organize inputs until the owner chooses Sort.
   - Resort now handles action, thread, both, and intention outcomes consistently, preserving original text, image references, rollback, and Undo behavior.
   - Paid Cloud entitlement can be honored offline only for the exact verified owner and only until the server-provided access expiry; expiry timers, storage changes, and the submit gate all revalidate it.
   - Provider status now distinguishes the configured preferred provider from a true fallback and claims rate limiting only when the preferred provider actually returned that coarse reason.

## Account erasure decision: source complete, activation blocked

The fail-closed backend path now exists: live-user plus recent email-OTP/session-bound prepare/confirm/status receipts, non-cascading durable operations, owner lifecycle locks, external provider admissions/capabilities, entitlement revocation, late Polar-event rewind, versioned worker leases, fixed provider stage order, app/Auth readback, and image ledger plus Storage enumeration. The worker runs one bounded stage per authorized call. All erasure routes remain default-off; confirmation and worker execution fail closed unless separate hosted-readiness and Storage-inventory attestations are present, while core-configured prepare/status can preserve receipt recovery. Source or local SQL does not prove provider deletion.

Remaining activation blockers are exact and hosted: verification that the durable fence is authoritative for still-live JWTs until Auth hard-delete revokes refresh families; authoritative Storage bucket inventory and a provider-documented quiescence/drain boundary covering pre-admitted standard/resumable/signed finalization and cleanup; real OTP claim shape; Polar capability lifetime/scopes/typed absence; Supabase Auth typed absence; deployed grants/RLS/triggers/fingerprints; and approved UI/copy/legal/retention behavior. `docs/cloud-account-erasure.md` and `docs/cloud-image-admission.md` are authoritative. Local tests prove state-machine, concurrency, RLS, quota, and upgrade behavior only; they do not prove backend-byte deletion or clear the hosted worker gate.

### Export relationship

Authenticated Cloud export is **not a prerequisite of erasure itself**: the foundation explicitly says export occurs only when the person requests it, and a person may choose irreversible deletion without an export. Erasure must never report failure merely because an unrequested archive was not created.

The source now implements complete owner-bound backup v3 export and additive restore, including authoritative Cloud state, tombstones, and verified remote images. Public paid Cloud still requires hosted clean-browser acceptance. Therefore:

- public playground/local/self-hosted launch can proceed independently of authenticated Cloud export;
- an explicitly internal Cloud trial can use the implemented backup v3 after hosted exact-owner readback;
- public paid Cloud requires a clean-browser hosted export/restore pass with remote images before release approval.

### Privacy/legal boundary

There is no `/privacy` or `/terms` route in the current public route map, navigation, or sitemap. The README still contains pre-Cloud claims such as “no account and no subscription,” “nothing is sent anywhere except to services you set up yourself,” and “no database.” Changing public copy was prohibited in this closeout. Public Cloud therefore also needs an approved privacy/terms/retention disclosure or an explicit decision to exclude Cloud from this launch. The account-free playground can be evaluated separately.

## Exactly two final manual sessions

All remaining genuinely manual work belongs to one of these two sessions. Source fixes discovered in Session A happen between A and B without creating a third owner session.

### Session A — hosted sandbox, providers, identity, billing, and storage

Run `npm run check:launch-hosted` before the owner joins; do not repeat its synthetic checks manually. Then, in one authorized sandbox campaign:

1. Freeze the exact preview/sandbox/project/account identities and read back non-secret configuration; confirm no production target or credentials are in use.
2. Apply only the reviewed sandbox migrations in order and read back schema, grants, RLS, Storage bucket controls, and application endpoint behavior.
3. **Partially completed:** OTP delivery and fresh sign-in worked for two distinct accounts; authenticated identities were stable and private/no-store; anonymous and free denials, paid board access, swapped-owner 412s, and missing-owner 428s passed. Still verify logout, expiry, cross-tab/account-switch revocation, same-account reverification, and hosted image isolation.
4. **Core path completed:** verified Polar sandbox checkout, signed-webhook entitlement, customer portal, and scheduled cancellation passed with server readback. Still exercise past-due timing, terminal expiry/revocation, duplicate delivery, reconciliation retry, provider spend ceiling, and test-instrument scope.
5. Establish never-used fresh image-bucket provenance, activate only the reviewed fresh mode, run five hosted concurrent publication rounds, reread attributed winners, and verify stale/direct/cross-account denial. Keep legacy cutover inactive without a provider drain.
6. **Completed before the owner session:** approved synthetic text passed real Cerebras Sort, forced-action Sort, and Distill with all four explicit tasks preserved and no invented task; an isolated every-provider-dead browser run preserved the exact capture as unsorted through reload and kept the composer usable.
7. Obtain the erasure decisions/evidence above, approve provider data-processing and backup-retention terms, and pass hosted backup v3 export/restore acceptance. Do not enable or execute real account erasure until the default-off source path passes against a disposable hosted account with explicit authorization.

### Session B — physical device, fresh visitor, PWA, native share, owner trial, and release approval

Use the frozen candidate produced after Session A source fixes:

1. **Automated hosted mobile coverage completed:** authenticated and anonymous 390×844 Retake runs passed capture, automatic answer/local-only Search, connected-Thread navigation, no duplicate Recall, Undo/readback, and overflow assertions. On clean physical desktop and phone profiles, still reach the first useful sorted result, understand Undo/correction, traverse public routes/navigation, inspect console/network, and exhaust the public trial intentionally.
2. Install/reopen the PWA, reload twice, compare the visible build with `/api/version`, enter real airplane mode after a cold reopen, capture/edit/add a photo, reconnect under the same account, and verify eviction/recovery behavior.
   - Sign in before enabling offline support. While offline, the saved capture must appear under **Waiting to sort**, not as a normal Action, and a still-valid paid Cloud account must not show the free trial counter.
   - After reconnecting, tap **Sort** and verify the card remains on failure, disappears only after success, and preserves the exact text and photo in its final destination.
3. Recover the same Cloud board on the second physical/clean device; exercise concurrent edits, tombstones, reload, attachment/cover/profile exact bytes, and consented earlier-board import.
4. Send selected day, thread, and tab payloads through a real native receiver, including applicable image attachments.
5. Run the agreed two-or-three-day owner trial, recording only bounded failures and confirming local work remains usable through provider/network failure.
6. Review final legal/release scope, optional Product Hunt assets/copy only if reconfirmed, preview cleanup, and give explicit release/publication approval. Without that approval, stop.

## npm audit discrepancy, reproduced honestly

Second-pass evidence on Node 22.18.0 / npm 10.9.3:

- `npm ls --all --json`: exit 0, `problems: []`, no Arborist/package-tree error.
- full, production-only, and package-lock-only `npm audit --audit-level=high --json`: exit 1 before advisory metadata, after the retirement notice and HTTP 400 from `/-/npm/v1/security/audits/quick`. This run returned generic `Bad Request`; the parent's equivalent run returned `Invalid package tree`.
- `npm ping`: registry reachable.
- a no-dependency control project audited to zero, so this is not a total registry outage and does not prove this project's payload is semantically accepted by the retired quick endpoint.
- npm 12.0.2 exposed the current bulk endpoint result: HTTP 503 “We are currently performing maintenance.” npm's status API reported service-wide scheduled maintenance from 17:00–19:00 UTC. npm 12 is unsupported on the current Node version, so this probe is endpoint evidence only, not the release audit command.

Conclusion: the current run produced **no vulnerability result**. The clean installed tree and prior zero audit are useful evidence, but neither converts the registry failure into a present zero-vulnerability claim. The discrepancy is an audit-endpoint availability/fallback failure during npm maintenance, not evidence of a newly invalid local package tree and not evidence of a vulnerability regression. Rerun the supported npm audit after maintenance on supported Node before release; do not churn dependencies in response to this transport result.

## Known blockers

- Durable Cloud image publication is intentionally unavailable until hosted activation evidence passes; legacy cutover is separately blocked on a provider-verifiable drain and complete preservation evidence.
- Billing and ownership are locally hardened but not accepted against the intended live sandbox and provider configuration.
- Account erasure is source-complete and default-off. Hosted stale-session fencing, Storage drain/quiescence, Polar/Auth readback, worker scheduling, UI copy, legal disclosure, and disposable-account acceptance remain mandatory before activation.
- Public Cloud cannot be approved while privacy/terms/retention disclosure and hosted backup/erasure acceptance remain unresolved. This does not block the separate account-free playground verdict.
- Current local Node is 22.18.0 while installed `jsdom` requests 22.22.2+ and `undici` requests 22.19.0+. Tests pass, but clean-install verification should use a supported Node version. README still says Node 20+; changing public setup copy was outside this preserve-copy closeout.
- Real-provider compliance for the checked synthetic explicit-task fixture passed on the isolated Preview. This is bounded provider evidence, not a guarantee for every phrasing.

## Executed verification

- `npm run check:launch-hosted`: **41 files / 474 tests passed**; disposable billing, quota, erasure, operational-retention, and complimentary-access SQL passed; blocked-legacy and fresh-publication SQL passed; the five-round browser simulator passed its success case and rejected both-success, missing-no-store, denied, and read-error cases as expected.
- Merged launch source `npm run check`: passed after bounding Vitest to one worker.
  - ESLint: zero errors, zero warnings.
  - Vitest: **227 files / 2,191 tests passed**.
  - TypeScript: passed with `--noEmit --incremental false`.
  - Next 16.3.3 isolated build: compiled, typechecked, and generated **35 static pages** while emitting the expected dynamic API routes.
  - Trace guard: **50 manifests**, no private paths.
- A second isolated production build with `NEXT_PUBLIC_PLAYGROUND=1` and `NEXT_PUBLIC_PUBLIC_SITE=1` passed; its trace guard also checked **45 manifests** with no private paths.
- Local production smoke: `/`, `/app`, `/about`, `/install`, `/pricing`, `/funding`, `/login`, `/robots.txt`, `/sitemap.xml`, and `/manifest.webmanifest` returned 200. Sample JS and CSS assets returned their correct content types and were not HTML fallbacks. `/api/version` returned build `a1f3686`.
- Built-playground browser checks at **1440×1000** and **390×844** passed:
  - no horizontal overflow, broken images, or page errors;
  - mobile navigation opened and closed with Escape;
  - desktop and mobile demo videos reached ready state 4 and used the correct desktop/mobile sources;
  - the empty app showed the playground notice, 15-capture meter, composer, and guidance;
  - Cloud subscription, sync, image, transcribe, TTS, and report probes all returned 404.
- Motion safety passed at both widths: **18 scroll-flow targets**, minimum centered opacity 0.920678 desktop / 1 mobile, zero post-scroll drift, reduced-motion zero hidden/animated targets, and no-JS opacity 1. Scrolled screenshots were visually inspected with no blocking overlap, clipping, or readability issue. A full-page screenshot without scrolling captures offscreen cards in their intentional edge-of-viewport animation state and is not a readability verdict.
- Billing SQL: `python3 scripts/run-polar-sql-local.py` passed historical/additive migrations, reconciliation, ownership, concurrency, grant/RLS, and deletion-lock regressions in a disposable local PostgreSQL cluster.
- Image SQL: legacy/default-closed and `--fresh` modes passed their disposable PostgreSQL race, RLS, readiness, provenance, and cleanup-model checks.
- Image acceptance client simulator: the correct 25-request batch passed; both-success, missing-no-store, denied, and read-error modes failed as expected without retrying PUT after a non-404 prerequisite.
- A fresh Retake synthetic Search-that-answers acceptance passed all **11 steps**, the artifact check, and direct scene inspection at **960×720**, 24 fps, and 7.0 seconds. Ordinary Search made zero Recall calls and displayed no answer surface; a stable question made exactly one Recall call and rendered only the Answer label, answer text, and one connected Thread control above unchanged local matches; the control opened the native cited Thread; and no clipping, overlap, squeeze, visible loading, provider explanation, or evidence inspector appeared. A local analytics stub removed the irrelevant development-only startup 404. The response was deterministic and synthetic, not evidence of live-model quality or deployed behavior.
- Hosted real-provider explicit-task acceptance passed with the repository's synthetic four-task fixture and no board mutation: normal Sort returned `kind=both` with all four tasks plus the thinking text, forced-action Sort returned exactly the same four tasks, and Distill settlement returned the same four tasks; all three used Cerebras and invented no fifth task.
- Hosted two-account and Polar sandbox acceptance used two distinct authenticated owners without printing either identifier. Before checkout, the second account was free and its own board returned 402. After a verified `sandbox.polar.sh` monthly checkout, the subscription route returned active Cloud and its own board returned 200. Both swapped-owner board requests returned 412, both missing-owner requests returned 428, and both own-owner requests returned 200. The sandbox customer portal then scheduled cancellation; server readback returned Cloud, canceled, monthly, `cancelAtPeriodEnd=true`, private/no-store, with access retained through a future expiry.
- Forced-dead-provider acceptance passed in a separate local origin with Cloud and all Jev gates off and every configured provider key intentionally invalid. Server evidence shows Groq, secondary Groq, Cerebras, Mistral, Gemini, and OpenRouter each rejected the request before `/api/sort` returned 503. Retake resolved all **9 steps / 2 scenes**: the exact synthetic capture was saved under Actions with “Landed in Actions, unsorted — sort it when the model is back,” remained after reload, and the composer stayed usable. The generic Retake artifact checker intentionally reports the expected 503 console event as a failure, so this result is supported by the scenario's explicit DOM assertions, server log, and direct inspection of both stills/contact sheet rather than represented as a clean generic artifact check.
- Hosted authenticated mobile acceptance passed at a real **390×844 viewport**: a synthetic Cloud capture produced one minimal Answer card, one connected Thread control, exactly one Recall request, native Thread navigation and return without duplicate disclosure/cost, no false rate-limit warning, no horizontal overflow, and successful Undo. Hosted visible-board readback confirmed the disposable marker was absent afterward. Retake artifact check passed at `outputs/capture-authenticated-mobile-launch-390-v4`.
- Hosted clean-visitor mobile acceptance passed at a real **390×844 viewport**: a fresh anonymous browser captured and retrieved a synthetic note through local Search, made zero Recall requests, rendered no Answer surface, and showed no horizontal overflow. Retake artifact check passed at `outputs/capture-clean-visitor-mobile-launch-390-v2`. The 960×720 MP4 canvas is Retake framing around the 390×844 browser viewport, not the app viewport.
- Shell syntax: preview verification, preview cleanup, phone, scorecard, and Chromium verification scripts passed `bash -n`.
- `npm ci` reproduced the fixed lockfile with npm 10.9.3. It warned that local Node 22.18.0 is below the declared jsdom/undici engines, but installed successfully.
- Earlier first-pass `npm audit --audit-level=high` and production-only audit: **zero vulnerabilities at that time**. The second-pass rerun is indeterminate because the registry returned quick-endpoint HTTP 400 and bulk-endpoint HTTP 503 during scheduled maintenance; it did not return advisory metadata.
- `git diff --check`: passed.

Temporary isolated build directories and local servers created by this closeout were removed. Browser reports and screenshots remain under `/tmp/capture-launch-closeout-browser` as session evidence. These local checks do not substitute for the manual hosted/provider/device gates above.
