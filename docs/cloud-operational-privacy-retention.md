# Capture Cloud operational privacy, retention, and health runbook

Internal engineering/operations contract only. This document is not public product, privacy-policy, pricing, legal, or retention copy.

## Source status

The operational worker is **disabled by default**. `POST /api/cloud/operations/cron` returns a private/no-store `503` until all of these are present:

- `CAPTURE_OPERATIONS_ENABLED=1`;
- a distinct, random `CAPTURE_OPERATIONS_WORKER_SECRET` of at least 32 characters;
- a deployed scheduler identity in `CAPTURE_OPERATIONS_SCHEDULE_ID`;
- an HTTPS `CAPTURE_OPERATIONS_ALERT_DESTINATION` owned by the operator; and
- `CAPTURE_OPERATIONS_ALERTS_VERIFIED=1`, set only after a real failing invocation reached that destination.

The endpoint accepts the secret only as a bearer header. It has no GET handler and does not read query parameters. The alert destination is an external scheduler/monitor contract, not an application webhook: the endpoint returns `503` whenever any aggregate signal is `critical`, so the configured monitor must page on non-2xx responses. Capture never sends note/account data to that destination.

Do not activate the route merely because source tests pass. Apply and read back the migration and complete the hosted steps below first.

## Operational event boundary

`src/lib/opsEvent.server.ts` is the only server operational log sink. Its exact fields are:

- schema version;
- enum event name;
- enum outcome;
- enum reason;
- coarse latency bucket; and
- coarse count bucket.

It must never receive or derive note/prompt text, model input/output, provider response bodies or messages, emails, user/session/operation/image identifiers, request URLs or paths, tokens, stack traces, error objects, or arbitrary strings. Provider parsing may still inspect a failure transiently to preserve rate-limit/fallback behavior, but logging retains only a fixed reason enum. `operationalLogging.test.ts` statically covers every API route and the Cloud/AI/billing/image/backup/erasure adapters so a new raw console call fails the source gate.

Vercel Analytics mounts only after known checkout, portal, erasure, and token query keys are removed from the browser URL. Checkout return polling crosses that replacement through a private boolean history-state marker; the checkout identifier is not retained there or sent to polling. Its `beforeSend` boundary strips every query string and fragment from every pageview/custom-event URL. Navigation-relevant nonsensitive state stays in the browser URL.

## Conservative source retention defaults

Migration `20260922300000_operational_retention.sql` runs bounded batches under a nonblocking global advisory lock plus a durable 60-second maintenance lease. The singleton row uses `NOWAIT`, candidate rows use `SKIP LOCKED`, and admission/capability cleanup uses nonblocking owner advisory locks; a contended owner is skipped for later replay instead of stalling while global/singleton/candidate locks are held. Every destructive statement repeats its eligibility predicate. Repeated and concurrent invocations are idempotent.

| Class | Source default | Eligibility and exclusions |
| --- | --- | --- |
| Board tombstones | 30 days | Matches the existing sync TTL. Up to 100 idle board rows per run; bumps `rev` under row lock so concurrent optimistic writes retry. Malformed tombstones are preserved. Board content is never inspected or logged. |
| Owner quota counters | Window expiry plus 7 days | Up to 100 fixed-window counters. Active windows and private policy rows remain. |
| Polar webhook delivery receipts | 400 days | Up to 100 receipts for a terminal, non-entitled, non-reconciling subscription whose source is also older than 400 days. The latest processed receipt remains, as does every receipt whose provider `event_created_at` equals the subscription `last_event_at` watermark, including equal-timestamp ties and a later-processed stale delivery. Subscription/customer/order/invoice/fiscal rows are never cleanup targets. |
| External work admissions and checkout/portal capabilities | Lease/expiry plus 7 days | Up to 100 of each. Nonblocking owner lock, skip-on-contention replay, and repeated expiry predicate required. Active provider work and unexpired capabilities remain. Image-operation inventory and physical quota are unaffected. |
| Image operational rows | 90 days after finalization | Only `released` or `deleted` rows, up to 100. `reserved`, `uploaded`, `published`, and `abandoned` rows remain. Publications, owner usage, Storage objects, and live inventory are never deleted. |
| Prepared erasure receipts | Receipt expiry, at most 1 hour after issue | Up to 100. A prepared row is not a confirmed obligation. |
| Completed erasure receipts | Receipt expiry, at most 30 days after completion | Up to 100, but only after immutable, content-free erasure evidence exists. Confirmed/in-progress obligations never expire through cleanup. |
| Erasure evidence | No source deletion | Operation UUID plus confirmation/completion timestamps and attempt/retry counts only; no owner, session, receipt secret, email, or content. Hosted legal policy must choose the eventual evidence-retention period before any deletion migration is proposed. |

The job must never delete active account-erasure stages, unresolved pending captures in board JSON, reconciliation-required billing sources, active/unexpired quota windows, Polar fiscal records, image publications or live image inventory, or required erasure evidence.

## Fixed aggregate health states and thresholds

The response contains exactly seven enum-valued signals (`ok`, `warning`, `critical`, or `unknown`) and no counts or identifiers.

| Signal | Warning | Critical | Notes |
| --- | --- | --- | --- |
| `overdueErasures` | A confirmed operation is due and unleased | Confirmed for at least 24 hours, or at least 10 retries | Any critical state pages. Never expose stage owner/operation IDs through this endpoint. |
| `billingReconciliation` | At least one unresolved source | At least 10 unresolved sources, or oldest due for at least 1 hour | Pending sources remain denied and are never cleaned. |
| `webhookDelivery` | — | — | `unknown` in source because database history cannot prove Polar endpoint enablement or expected traffic. Use the hosted readback below. |
| `imagePressure` | At least 10 expired unresolved operations, or any owner at 80% object/byte capacity | At least 100 expired unresolved operations, or any owner at 95% capacity | No stale reclaim is authorized. This is pressure only. |
| `quotaPressure` | At least one owner at 90% of an active request window | At least 10 owners at 90% | Counts are evaluated in SQL but never returned. |
| `readinessDrift` | — | Required function/table missing or image-admission readiness/fingerprint fails | A provider-hosted policy readback is still mandatory. |
| `maintenance` | Last successful run at least 2 hours ago | No successful run, or at least 24 hours old | Intended schedule is hourly; choose and verify the hosted schedule before enabling. |

## Kill switches

1. Set `CAPTURE_OPERATIONS_ENABLED=0` or remove it. This disables maintenance and health immediately after redeploy.
2. Disable the scheduler before rotating `CAPTURE_OPERATIONS_WORKER_SECRET`; then rotate and verify one authenticated call before re-enabling the schedule.
3. Remove `CAPTURE_OPERATIONS_ALERTS_VERIFIED` whenever the alert route changes. The worker then fails closed until a real alert test is acknowledged again.
4. Keep `capture_image_storage_policy.stale_reclaim_enabled=false`. Operational pressure never authorizes stale image release or deletion.
5. The separate account-erasure worker is source-wired but independently default-off. It requires `CAPTURE_ACCOUNT_ERASURE_ENABLED`, `CAPTURE_ACCOUNT_ERASURE_HOSTED_READY`, an exact Storage-inventory attestation, and its distinct bearer; this operational worker does not set or bypass those gates.
6. On migration/readiness drift, disable the operational worker and Cloud writes rather than editing fingerprints or grants ad hoc.

## Hosted apply and readback

Use an isolated Supabase project first. Do not run these steps against production without separate schema/deploy authority.

1. Apply migrations in order through `20260922300000_operational_retention.sql`.
2. As `anon` and `authenticated`, verify no table access and no execute access to either operational RPC.
3. As `service_role`, read back exact function definitions, owner/execute ACLs, RLS state, evidence triggers, batch limits, and the maintenance singleton. Confirm no public/browser policy exists.
4. Seed synthetic expired/current rows and run the service RPC twice. Verify the same exclusions as `scripts/test-operational-retention-sql.py`, then remove the synthetic rows.
5. Invoke concurrent runs and verify exactly one completes while the other reports contention. Separately hold the singleton row and an owner advisory lock: each maintenance call must return within its statement timeout, uncontended owners must progress, and a later replay must remove the skipped expired rows. Run the reversed owner-lock/row-lock fixture and require both transactions to complete without deadlock.
6. Confirm `capture_operational_health()` returns exactly the seven fixed keys and four allowed state values.
7. Read back `capture_image_admission_ready()` and all previously required publication/grant fingerprints. Do not activate if any drift is reported.
8. In Polar, verify the webhook endpoint is enabled, its most recent expected delivery succeeded, retry exhaustion is not disabling delivery, and a synthetic signed event reaches the ledger. Database staleness alone cannot prove this.
9. Configure an hourly scheduler with Authorization header injection. Never put the bearer in the URL. Confirm request logs, scheduler logs, and alert payloads contain no bearer or full URL.
10. Configure the external monitor to page on endpoint non-2xx. Force a synthetic critical aggregate in the isolated project and verify the named alert destination receives it. Only then set `CAPTURE_OPERATIONS_ALERTS_VERIFIED=1`.
11. Run one successful hosted maintenance call, read back `last_completed_at`/`last_outcome`, and verify the next aggregate response is identifier-free.

## Hosted retention decisions still required

- Supabase database point-in-time recovery, automated backup retention, Auth audit retention, Storage versioning, platform request/function log retention, and Log Drains are plan/project controls. Choose them in the hosted consoles and record screenshots/readback; source does not guess or claim them.
- Confirm with legal/accounting whether 400 days is acceptable for non-latest subscription-delivery receipts and choose an explicit duration for immutable account-erasure evidence. Until then, evidence has no source deletion path.
- Select the actual hourly scheduler and the real alert destination/escalation owner, then perform the failure-delivery test above.
- Polar endpoint enablement/disablement remains a hosted dashboard/API readback because it is not knowable from Capture's database alone.
