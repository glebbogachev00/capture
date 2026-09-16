# Capture Cloud billing hardening — local verification, remote approval required

**Current status:** the authorized follow-up below implements equal-timestamp reconciliation and the documented initial past-due anchor. The first-pass findings are retained as historical evidence, not current unresolved design blockers. No migration has been applied remotely.

## Review corrections — tracked invalid state, checkout eligibility, deletion locks

Local review follow-up adds `20260913210000_polar_review_guards.sql`; no historical migration was rewritten or applied remotely.

- **Tracked invalid webhook:** RED reproduced terminal missing-identity/off-catalog events returning 202 instead of retryable failure. The handler now passes invalid subscription envelopes to a service-only SQL queue function that only affects tracked IDs. It preserves the stored owner/customer/product, atomically ledgers and denies nonstale events, and uses the existing durable lease/version reconciliation. Unknown unrelated IDs create no source or ledger row and cause no provider GET. Invalid authoritative identity/catalog still cannot finish; duplicate delivery retries pending work without resetting its lease. Syntactically valid changed owner/customer bindings also queue denial rather than rolling back with the old access intact.
- **Purchase eligibility:** RED reproduced 200 and checkout creation for a denied pending source through the actual dependency factory and installed Supabase request builder (fetch intercepted; no external request). Checkout now checks owner-scoped `reconciliation_required OR (is_entitled AND unexpired)`, separately from resource authorization, and returns 409 for uncertain billing. Status falls back to an older pending row before newer inactive history. Settings retains Manage subscription and Retry status rather than advertising another purchase. Additional RED tests caught the old hidden management UI and missing pending status field.
- **Deletion ordering:** RED in actual disposable PostgreSQL reproduced `deadlock detected` between parent deletion and event application. All callable mutation paths (apply, invalid queue, claim, finish) now acquire the immutable auth-parent key-share lock before subscription/ledger row locks, under the existing subscription-ID advisory serialization. The base function remains inaccessible to service-role callers; the queue selector is read-only. Independent tests hold the auth parent, wait for each RPC's actual lock wait, then cascade deletion with bounded timeouts.
- **Self-review correction:** a changed-owner webhook waiting behind deletion could otherwise see the source disappear and treat it as a new subscription. A further RED SQL race reproduced that re-creation. The lock helper now remembers the observed binding across the wait, preventing ownership transfer even when deletion wins.

Verification after these changes:

- Focused billing/status/UI: **9 files / 75 tests passed**, `--maxWorkers=2`.
- Final full suite: **163 files / 1360 tests passed**, `npx vitest run --maxWorkers=2`.
- Disposable local PostgreSQL runner passed actual historical/additive migrations, tracked invalid/stale/duplicate denial, leases/fences/repair, unrelated-ID ignore, unaffected second source, owner/customer immutability, grants/RLS, concurrent events/claims, and deletion races including changed-owner application. Cluster stopped and removed.
- `npx tsc --noEmit --incremental false`, `npm run lint`, `git diff --check` passed; lint retains the unrelated existing unused `Frag` warning.

Files changed in this review: `polar.ts`, `polarServer.ts`, their billing tests (including new `polarCheckoutEligibility.test.ts`), `cloudSubscription.ts`, subscription route/test, `CloudBilling.tsx`/test, `scripts/test-polar-sql.py`, the new additive migration, and this report. No unrelated source edits, builds, commits/index/branch changes, real APIs/charges, env-file/secret reads, deployments, or remote schema operations.

**Not production signoff.** Existing request-driven recovery remains: invalid authoritative state stays denied/pending and blocks another purchase until repaired; idle work waits after delivery retries exhaust. Historical ignored envelopes cannot be reconstructed by this migration. A sandbox deployment, migration-order/schema-cache compatibility, live provider/PostgREST integration, and rendered-device acceptance remain separate gates. The local UI test exercises rendered DOM and click wiring, not a deployed browser session.

## First pass (historical)

## Scope

Local-only work. No deploy/build, live billing calls/charges, remote database/schema/account changes, or application secrets/env-file reads. Existing unrelated dirty work preserved. Historical migrations were not edited. The additive migration below has only run in a disposable local PostgreSQL database.

## Reproduced and corrected

1. **Status truncation:** the real subscription GET route selected the newest 20 rows before looking for entitlement. A route regression with 25 newer inactive rows and one older active row returned `tier: free`, `captureLimit: 15`. It now filters for the owner's current entitlement before limiting to one result, falling back to the latest historical row only when none is current. Queries remain bounded and scoped to the authenticated owner. The regression now returns Cloud; another-owner access is excluded.
2. **Missing auth user:** executing the actual prior billing migrations in PostgreSQL demonstrated that a syntactically valid but absent `auth.users.id` raises `polar_webhook_events_user_id_fkey`; the transaction rolls back. The webhook handler converts RPC errors to 500, so retrying cannot repair a deleted/unrecognized account. `20260913190000_polar_missing_user.sql` locks an existing auth row with `FOR KEY SHARE` through the transaction. If none exists, it records the delivery with a null FK and returns false, granting no access. The handler already acknowledges a successful false RPC result. This preserves deduplication without creating users or weakening subscription ownership checks. An ignored delivery stays ignored if the same UUID is later inserted: replay/reconciliation would need an explicit separate operation.
3. **Terminal snapshots:** tests reproduced `subscription.updated` with terminal `canceled` or `unpaid` status, a retained cancellation flag, and a future period end incorrectly granting access. Normalization now denies those terminal snapshots and expires them at the event timestamp. This implements the documented terminal lifecycle, not a new paid-access policy. Scheduled cancellation with active status remains entitled through the paid period; the existing three-day past-due policy is unchanged.

## Confirmed unresolved: equal timestamps

The SQL runner applies contradictory active/revoked events to two subscriptions in opposite orders at the same timestamp. The stored results are **active, revoked**: first arrival wins. Both deliveries are ledgered. The existing strict timestamp predicate prevents stale overwrite, but cannot establish which equal-timestamp snapshot is authoritative. No arbitrary event-ID lexical comparison was added.

**Approval/design fork before further implementation:** authorize a durable, retryable authoritative reconciliation path for ambiguous subscription events, preferably fetching the exact subscription by provider ID and checking its customer/product binding. Define serialization/version fencing so a delayed fetch cannot overwrite a newer event. Customer State is another documented option, but replacing local access decisions with its active-subscription list could change Capture's custom past-due grace behavior. Do not silently substitute it. Do not acknowledge-and-forget ambiguous events, or make an unbounded synchronous remote call inside the webhook, without the durable recovery design. Existing equal-timestamp behavior remains a launch risk, not a completed fix.

The docs reviewed do not specify a chronological event-ID tie-breaker. Provider timestamps alone do not resolve the reproduced tie.

## Other policy boundaries

- Refunds do not universally terminate subscription access. Polar says a subscription-order refund returns money without ending the subscription; subscription cancellation/revocation is separate. Automatic chargeback-prevention refunds can also cancel the subscription. No `order.refunded` shortcut revokes Capture access.
- Polar's documented grace is measured from `past_due_at`; Capture currently uses each event's timestamp plus three days. That can move the expiry on later past-due updates. The three-day duration/anchor and reconciliation compatibility need explicit policy approval; this patch does not choose a replacement policy.
- Account/schema preparation and externally reachable signed sandbox lifecycle testing remain outside this local pass. Local PostgreSQL with a minimal auth schema is not proof of live Supabase configuration or production deployment.

## Official evidence consulted

- [Webhook delivery and signing](https://polar.sh/docs/integrate/webhooks/delivery): retry behavior; SDK support for both legacy Polar HMAC and Standard Webhooks secrets (SDK alpha.19+).
- [Subscription lifecycle](https://polar.sh/docs/features/subscriptions/introduction): scheduled cancellation keeps access until period end; immediate revoke transitions to canceled and revokes benefits; unpaid is terminal.
- [Failed payments](https://polar.sh/docs/features/subscriptions/failed-payments): `past_due_at` and configurable provider grace; provider grace options are not Capture's policy.
- [Refunds](https://polar.sh/docs/features/refunds): subscription refunds versus cancellation and automatic chargeback-prevention handling.
- [Customer State](https://polar.sh/docs/integrate/customer-state): authoritative customer-state API and active subscriptions, as a design candidate only.

## Verification

- RED: route regression returned free instead of Cloud; GREEN after query fix.
- RED: actual SQL missing-user call raised FK violation; GREEN after additive migration.
- RED: both terminal snapshot cases returned `isEntitled: true`; GREEN in full suite after normalization fix.
- Installed `@polar-sh/sdk/2026-04` validator exercised using independently generated HMAC signatures and public synthetic test-only material. Both Standard Webhooks and legacy signing accepted; tampered body, ID, timestamp, signature, and reserialized JSON rejected before any subscription write. No SDK validator mock or credentials used.
- `python3 scripts/test-polar-sql.py <disposable-local-socket-dir> 55439`: passed on the already-installed PostgreSQL, TCP disabled. Exercises actual original/additive migrations, orphan ledger/dedup/no grant, duplicate/stale delivery, ownership/customer mismatch and rollback, service-only RPC, authenticated write denial, and cross-owner SELECT RLS. Also preserves an explicit characterization of unresolved equal timestamps. Auth table/roles are synthetic; no concurrent deletion/ownership stress test or live Supabase/PostgREST test was claimed.
- `npm test -- --maxWorkers=2`: **157 files, 1292 tests passed**.
- `npx tsc --noEmit --incremental false`: passed.
- `npm run lint`: zero errors, one unrelated existing unused `Frag` warning in `src/lib/fragOps.ts`.
- `git diff --check`: passed.
- No shared `.next` build was run.

## Changed files in this pass

- `src/app/api/cloud/subscription/route.ts`
- `src/lib/cloudSubscriptionRoute.test.ts` (new)
- `src/lib/polar.ts`
- `src/lib/polar.test.ts`
- `src/lib/polarSignature.test.ts` (new)
- `supabase/migrations/20260913190000_polar_missing_user.sql` (new, not applied remotely)
- `scripts/test-polar-sql.py` (new)
- This report (new)

`polarServer.ts`, the checkout/portal/webhook route wiring, and `cloudSubscription.ts` were inspected and left unchanged in the first pass. The subscription-entitlement-integration skill's unsafe generic deterministic tie-breaker guidance was corrected to require provider-supported ordering and approved reconciliation.

## Authorized follow-up — equal-timestamp correctness

The user authorized local implementation of authoritative reconciliation and retaining the **THREE DAY** grace using the documented initial anchor. No paid service, cron, worker deployment, or new infrastructure was added.

### Durable state machine

- Additive `20260913200000_polar_reconciliation.sql` wraps the previous audited apply function; historical migrations remain untouched. The original function is renamed to an internal base and its service-role direct execution is revoked.
- Transaction-scoped per-subscription advisory locks serialize first inserts, ownership checks, ties, claims, and finishes. The original ledger/entitlement transaction and missing-user behavior remain intact.
- Equal-timestamp distinct normalized snapshots durably set `reconciliation_required` and suppress `is_entitled` **only for that subscription**. No lexical event-ID ordering. Other valid subscriptions still supply access.
- `state_version` fences every nonstale accepted event, fetch claim, and successful finish. A 30-second durable claim lease bounds concurrent work. A crash, timeout, provider error, mismatched identity/customer, unknown product, malformed past-due anchor, or stale result cannot clear the obligation or grant/extend access. A new event during a fetch invalidates the old result.
- Once ambiguous, `authoritative_mode` stays enabled. Future nonstale deliveries also require GET reconciliation: a delayed webhook generated before a GET must not overwrite its authoritative result just because its envelope timestamp is newer than our previous webhook watermark. Fetch wall time is never used as event chronology.
- Existing rows with multiple same-owner deliveries at their current watermark, and existing past-due rows whose old grace anchor is untrusted, are queued by the migration and denied until repaired. Null-owner ignored deliveries do not seed false conflicts.
- The service fetches the **exact subscription ID** with `polar.subscriptions.get(id, { timeout: 2 })`, then normalizes `subscription.updated` from current provider status—not from the old webhook's revoked/active event name. Immutable subscription/user/customer binding is checked in the service and SQL. Product/plan must map to the configured Capture catalog; legitimate monthly/yearly switches are allowed rather than stuck behind an old product binding.
- Scheduled cancellation with provider status active/trialing retains access through the paid period after successful reconciliation. Terminal `canceled`/`unpaid` never receives that access.

### Retry without new infrastructure

1. Webhook processing durably applies/queues before attempting the bounded provider GET. Failure returns 500 for provider retry. **Duplicate ledgered events still attempt pending reconciliation.**
2. The authenticated subscription-status route retries one due pending subscription for the **verified owner**, using a service-only bounded queue query. It runs before reading entitlements. Failures leave the row denied and pending; another valid subscription remains usable.
3. This is **request-driven recovery**, not an always-running worker. If Polar exhausts deliveries and the user is idle, the durable job waits for a subsequent status request/reload or an operator-triggered redelivery. No claim of guaranteed idle-time background execution is made.
4. Polar documents ten retries and endpoint disabling after ten consecutive failures. Monitor that state: on-demand recovery repairs recorded rows but cannot re-enable the provider endpoint or retrieve events that never arrived.

### Past-due policy

`past_due_at` is documented as stamped at the first renewal payment failure. Capture now computes `past_due_at + 3 days`, independent of repeated event timestamps. ISO timestamps with offsets are accepted; calendar rollover, absent/null/malformed values, and anchors later than the event are denied. An expired valid anchor stays expired. During reconciliation, an unusable past-due anchor is a retryable failure, not a completed repair. Capture does not adopt Polar's configurable 2/7/14/21-day benefit grace.

### Independent source verification

Re-read the current route, normalizer, prior additive missing-user migration, and actual signature tests—not only the earlier summary. Confirmed the entitlement-before-limit query, active scheduled cancellation versus terminal snapshots, null-FK orphan deduplication, and real installed-SDK Standard/legacy HMAC validation.

Installed package: `npm list @polar-sh/sdk --depth=0` returned **1.0.0-alpha.21**. Its `dist/2026-04/services/subscriptions.d.mts` declares `get(id: string, requestOptions?)`; `base-C5EE71lz.d.mts` documents timeout seconds, and `base-CpxoQZCZ.mjs` uses `AbortSignal.timeout(timeout * 1000)` with one fetch, no internal retry loop. The 2026-04 subscription model includes optional nullable `past_due_at`.

Official sources freshly read:
- [Get Subscription, 2026-04](https://polar.sh/docs/api-reference/2026-04/subscriptions/get-subscription): exact GET, subscription fields and SDK call. Installed service docs identify `subscriptions:read` / `subscriptions:write` scopes.
- [Failed payments](https://polar.sh/docs/features/subscriptions/failed-payments): initial `past_due_at`, grace anchor, provider grace options.
- [Lifecycle](https://polar.sh/docs/features/subscriptions/introduction): scheduled cancellation vs immediate revocation/terminal states.
- [Delivery](https://polar.sh/docs/integrate/webhooks/delivery): signing migration, 10-second delivery timeout, retries and endpoint disabling.

### Follow-up verification

- Fail-before-fix observed: repeated grace extended from delivery time; malformed/missing authoritative anchor incorrectly completed; equal opposite orders granted by first arrival; absent claim/finish path; duplicate webhook falsely acknowledged provider failure; a delayed pre-fetch webhook overwrote an already reconciled result without sticky mode; historical ties stayed unrepaired; legitimate configured product switch got stuck.
- Focused final billing suite: **4 files / 47 tests passed** (`--maxWorkers=2`), including installed SDK signature validation and mocked exact provider GET (no real account calls).
- `python3 scripts/run-polar-sql-local.py`: **passed**. Boots installed PostgreSQL in a temporary Unix-socket-only cluster, creates a random test database, runs actual historical and additive migrations, then stops/removes the cluster. Verifies old baseline failures, both tie arrival orders, migration seeding, duplicates/stale events, durable crash retry, claim contention, version fencing, binding/rollback, plan switches, scheduled cancellation, RLS/service-only grants, real concurrent first inserts/events/claims, and convergent authoritative results. Auth roles/users are synthetic; this is not live Supabase/PostgREST proof.
- `npx tsc --noEmit --incremental false`: passed. `npm run lint`: zero errors, existing unused `Frag` warning only. `git diff --check`: passed.
- Full bounded run initially hit the unrelated performance timing threshold while SQL/type/lint ran concurrently (24ms vs 20ms); a serial rerun passed **161 files / 1321 tests**. After the final product-switch regression, a later full run observed concurrent action-linking worker changes: **162 files, 1327 passed / 5 failed**, all failures in `sortThreadAssociation.test.ts`. Billing tests remained green. That worker owns the sort/UI path; no changes were made there. Parent must run the final shared-tree suite after workers settle.

### Follow-up artifacts and remaining permissions

Modified billing files: `src/lib/polar.ts`, `src/lib/polar.test.ts`, `src/lib/polarServer.ts`, `src/app/api/cloud/subscription/route.ts`, `src/lib/cloudSubscriptionRoute.test.ts`, `scripts/test-polar-sql.py`, this report.

New: `src/lib/polarReconciliation.test.ts`, `scripts/run-polar-sql-local.py`, `supabase/migrations/20260913200000_polar_reconciliation.sql`.

Remote work still requires authorization: apply additive migrations in order; verify the intended sandbox token has subscription-read scope; deploy compatible code; verify publicly reachable signed webhook lifecycle, provider timeout/retry/redelivery, exact subscription/customer/catalog binding, scheduled cancellation, initial past-due grace, expired/revoked access, status-driven recovery, and endpoint enablement. No remote schema apply, real-customer GET, account changes, charge, deploy, commit, secrets/env-file read, or shared `.next` build occurred here.
