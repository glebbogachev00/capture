# Capture Cloud account-erasure backend contract

Internal engineering contract only. This document does not supply Settings, privacy, legal, retention, or confirmation copy.

## Safety boundary

- The erasure workflow is source-only until every hosted gate below is complete.
- `capture_account_erasure_operations` is service-only and keyed by a random UUID. Its nullable owner UUID deliberately has no Auth foreign key, so Auth deletion cannot cascade, null, or otherwise mutate the durable obligation between provider deletion and the final compare-and-swap. Completion explicitly clears the owner.
- The table stores only hashes and operational metadata. It does not store an email address, board data, object names, request bodies, provider responses, or exception text.
- The 256-bit receipt secret is returned once by `prepare`; only its SHA-256 hash is stored. The secret is accepted only in JSON POST bodies. Query strings are rejected, and erasure routes do not log request-derived values.
- Prepared receipts expire within one hour. Completed receipts contain only operation/stage/timestamps and expire no later than 30 days after completion. Before a completed receipt can be removed, the additive operational-retention migration records immutable content-free completion evidence (operation UUID, confirmation/completion timestamps, attempt/retry counts; no owner/session/secret/content). Cleanup locks at most 100 eligible rows with `FOR UPDATE SKIP LOCKED`, and its `DELETE` repeats both the stage and expiry predicates. A row concurrently confirmed and fenced cannot be selected or removed; an in-progress obligation cannot age out. The evidence has no source deletion path until hosted legal policy sets a required duration.

## Route contracts

All routes are dynamic Node.js POST handlers with private/no-store responses and a 60-second ceiling.

### `POST /api/cloud/account-erasure/prepare`

Headers:

- `X-Capture-Owner: <exact authenticated UUID>`

Body:

```json
{}
```

Requires a live Supabase Auth `getUser()` response plus verified JWT claims for the same UUID and normalized confirmed email, a non-empty `session_id`, and a timestamped `amr.method = "otp"` entry no older than `CAPTURE_ERASURE_AUTH_WINDOW_SECONDS`. The default and maximum are 600 seconds; invalid configuration fails closed. Repeating an unconfirmed prepare rotates the receipt hash on the same operation so a lost response is recoverable. A confirmed operation cannot be replaced.

Successful response fields: `operationId`, one-time `receiptToken`, `stage`, `expiresAt`.

### `POST /api/cloud/account-erasure/status`

Body:

```json
{ "operationId": "<uuid>", "receiptToken": "<43-character base64url secret>" }
```

Before Auth deletion, status also requires the same live owner, exact `X-Capture-Owner`, original session, and recent OTP evidence. After completion has nulled the owner, the bounded receipt remains usable without a session. Wrong owner/session/receipt/operation and expired receipts all return the same not-found result.

Successful response fields are content-free: `operationId`, `stage`, `complete`, `confirmedAt`, `completedAt`, `retryAfter`.

### `POST /api/cloud/account-erasure/confirm`

Headers and body combine the prepare and status contracts. Confirmation takes the owner lifecycle lock, removes only expired admissions/capabilities, and fails closed if any provider admission is active or any checkout/portal capability remains conservatively unexpired. Only then does it atomically change `prepared` to `polar`, establish the database read/write fence, and revoke local entitlement. Duplicate confirmation is idempotent.

## External-work admission and quiescence

- Every Cloud managed-AI route acquires a random owner-bound admission in PostgreSQL before reading the request body or invoking any local/hosted model, transcription, or TTS provider. Every route releases that exact admission in `finally`, including provider errors and early response paths.
- Checkout, portal, and subscription-reconciliation paths use the same protocol before Polar invocation. Checkout/portal admission transactions also reserve a durable capability row **before** provider invocation, so provider success followed by a lost app response cannot create an untracked URL; reconciliation has no user-held capability.
- Every image PUT reserves an exact physical object and byte count before Storage. The service-only reservation creates an `image_upload` admission under the same owner lock and a database-generated path. Finalize or safe typed-absence release removes it; a crash leaves it until the bounded lease. Expiry never releases physical quota because a provider completion may still land.
- Managed-AI/billing admissions have a conservative ten-minute lease while provider work is bounded by the route ceiling (and Polar calls use a 30-second SDK timeout). Image admissions use a database-owned 120-second default bounded to 60–600 seconds. A lost release blocks confirmation until the applicable lease expires; tests exercise reclamation at that boundary. Confirmation and admission acquisition serialize on the same owner advisory lock, so their race has only two safe outcomes: the admission exists and confirmation fails, or the fence exists and admission is denied.
- Checkout/portal capability expiry is intentionally conservative: seven days by default, configurable with `CAPTURE_POLAR_CAPABILITY_MAX_SECONDS` from 60 seconds through 30 days. This is a safety bound, not a claim about Polar behavior.
- **Activation remains blocked.** The exact hosted Polar checkout/portal lifetime, one-time/replay behavior, and invalidation contract have not been proven. Before activation, pin a provider-documented upper bound/invalidation mechanism, verify it in sandbox, set the configured bound no shorter than that proof, and retain the durable confirmation block.
- Worker stage advancement independently rejects active admissions. The Auth preflight removes only expired rows and rechecks both active admissions and capabilities before the Auth provider call.

### `POST /api/cloud/account-erasure/worker`

Uses a separate constant-time bearer from `CAPTURE_ACCOUNT_ERASURE_WORKER_SECRET` and executes exactly one leased stage per invocation. The worker and confirmation readiness checks share one validation rule: the trimmed secret must be present and at least 32 characters. Repeating the route resumes due or expired work without an in-request provider loop. All erasure routes are undiscoverable unless `CAPTURE_ACCOUNT_ERASURE_ENABLED=1`. Prepare and receipt status then require the core Cloud/service configuration; confirmation and the worker additionally require a valid worker secret, both `CAPTURE_ACCOUNT_ERASURE_HOSTED_READY=1` and `CAPTURE_ERASURE_STORAGE_INVENTORY_ATTESTED=1`, and complete Polar/provider configuration. A prepared receipt can therefore still be read while destructive providers are unavailable, but the account cannot be fenced into an unserviceable obligation.

The installed Supabase Admin SDK can globally sign out only from a user's JWT, not by owner UUID. The `sessions` stage therefore establishes and reads back the durable database fence as the authority for still-live access JWTs. Every Cloud read/write/provider admission rejects the owner after confirmation; final Auth hard-delete revokes refresh-token families. Hosted acceptance must prove that boundary with stale JWTs before setting the readiness flag. The tested worker core and provider adapters are injected; tests never call Supabase, Polar, Vercel, or hosted Storage.

## Durable stage order

A versioned 30-second lease permits one worker to own one stage. Every compare-and-swap includes operation ID, owner (except owner-null Auth completion), lease ID, version, and current stage. Expired leases can be reclaimed. A crash after an external mutation replays the same idempotent mutation and readback.

1. **`polar`** — delete by immutable external owner ID with `anonymize: true`; only Polar SDK `ResourceNotFound` is already complete; exact external-ID GET must read back the same typed absence. A generic HTTP/gateway/routing 404 is unavailable.
2. **`sessions`** — establish and read back the durable database fence as session authority for still-live JWTs. The installed owner-UUID Auth API cannot independently enumerate/revoke all sessions; Auth hard-delete remains the final refresh-family revocation.
3. **`storage`** — first enumerate every non-released image-operation path, remove it through Storage API, exact-read typed absence, mark the ledger row deleted, and prove the ledger empty. Then repeatedly list the first bounded exact-owner page in every approved bucket, remove it, exact-read every path, and finish with authoritative empty inventory. This catches both post-migration admissions and pre-ledger legacy/orphan candidates. Missing objects are success. Each removal batch retries at most three times; one attempt processes at most 100 pages of 100 names and persists a retry rather than claiming completion if the bound is reached. The production adapter returns authority only when the hosted-attestation flag is set and a live `listBuckets()` readback contains every allowlisted Capture bucket and no unexpected `capture-*` bucket; otherwise this stage cannot advance.
4. **`app_rows`** — service RPC deletes board, publication, image-operation, image-usage, quota, subscription, admission, and capability rows; a separate RPC must read back no rows. The erasure operation and Polar webhook ledger are retained.
5. **`auth`** — repeat Polar delete plus typed-absence readback immediately before the Auth preflight, then hard-delete Auth last. Only Supabase Auth's typed `AuthApiError` with status 404 and code `user_not_found` is absence; generic 404 is unavailable. A successful `getUserById` proves presence only when it returns a valid user whose ID exactly matches the owner. A 2xx/null, malformed user, or mismatched ID is unavailable and cannot complete the operation.
6. **`complete`** — atomically null owner/session linkage and issue the bounded content-free receipt.

Current source-approved Storage buckets are exactly:

- `capture-images`
- `capture-image-candidates`
- `capture-image-candidates-fresh-20260914`

The hosted inventory gate must prove there are no additional Capture-owned buckets before worker activation. An unexpected bucket is a launch blocker; do not infer or silently skip it.

## Write fence

`capture_account_deleting(uuid)` becomes true in the same transaction that confirms erasure. Database-owned mutations call `capture_account_write_allowed(uuid)`, which takes a shared lock on the prepared operation row; confirmation takes an update lock on that same row. A mutation admitted first finishes before confirmation revokes access, while confirmation admitted first makes the waiting mutation observe the fence and deny. The application also checks the fence before billing/quota, and SQL enforces it at the mutation itself for:

- board insert/update/delete;
- publication insertion and its trigger;
- legacy, candidate, and fresh Storage insert admissions;
- service-only image object/byte reservation, upload recording, finalization, release, and their `image_upload` work admission;
- checkout and portal creation;
- owner quota consumption;
- Polar subscription event application;
- invalid-event queuing;
- reconciliation next/claim/finish.

Signed late webhooks remain acknowledged and ledgered. While an operation is confirmed, any valid subscription event atomically rewinds it to `polar`, clears the stale worker lease, increments its version, and keeps access denied. A stale worker therefore cannot advance or complete; the replayed Polar stage remains idempotent. After Auth deletion events are ledgered with a null owner and cannot recreate a subscription because no Auth parent exists.

### Read/export policy

- No operation: existing exact-owner authorization and billing/quota rules apply.
- `prepared` and unconfirmed: exact-owner board/image backup/export reads remain allowed, including billing-independent recovery reads and their durable backup quota.
- Confirmed (`polar` through `auth`): every read is denied, including ordinary board/image/subscription reads and explicit backup/export reads. Application guards check `capture_account_deleting`, and restrictive board/subscription/publication/Storage SELECT policies call `capture_account_read_allowed` inside PostgreSQL.
- `complete`: Auth is absent and the owner link is nulled; only the bounded content-free erasure receipt remains readable.

## Remaining UI/copy gates

No user-facing or public copy was added or changed. Before exposing this backend, approved wording and UI are still required for:

- Settings entry point and consequence summary;
- recent-OTP reauthentication flow;
- typed/explicit confirmation interaction;
- receipt presentation, safe local handling, and status polling;
- failure/retry/contact language;
- privacy, terms, retention, processor, billing-history, and tax-record disclosures.

Do not derive that wording from this engineering document.

## Remaining hosted gates

1. Apply the additive migration to an isolated hosted project and verify grants, RLS, functions, fresh-image fingerprint re-attestation, and rollback behavior.
2. Capture a real email-OTP JWT fixture and verify `sub`, `session_id`, and the `amr` timestamp contract against the deployed Supabase Auth version.
3. Verify with a stale access JWT and refresh attempt that the deployed database/application fence blocks every owner read, write, provider admission, and reconciliation from confirmation until Auth hard-delete; verify hard-delete revokes subsequent refresh. If Supabase adds a documented owner-UUID global-revocation/readback API, prefer and separately attest it rather than inferring support.
4. Apply the image-admission migration and attest direct authenticated INSERT denial for standard, resumable, signed, copy/move, and metadata routes while service-reserved generated-path upload still works. Attest the complete private Storage bucket inventory and test ledger plus provider enumeration with more than 1,000 synthetic objects, missing objects, list/remove retries, lease expiry, crash replay, and final exact-path/zero readback. The observed hosted Storage implementation can finish a pre-admitted create-only upload after policy admission; require a provider-documented quiescence/drain boundary covering every pre-admitted finalization/cleanup so no object can appear after the worker's final readback. Until then `providerInventoryIsAuthoritative()` remains false and stale reclaim remains disabled.
5. Capture a real hosted OTP JWT and prove the exact `amr.method`, numeric timestamp, and `session_id` claims used by destructive confirmation.
6. Verify Polar organization-token scopes include `customers:write` and `customers:read`; verify the installed SDK's typed `ResourceNotFound` for both delete/readback; prove checkout and portal capability lifetime/invalidation as described above; run sandbox delete/anonymize + external-ID typed-absence readback with a synthetic customer.
7. Verify hard-delete and typed `user_not_found` readback in an isolated Supabase project only after all prior stages pass; separately prove generic Auth/gateway 404s remain unavailable.
8. Apply and read back every table/function grant, RLS policy, trigger, and policy fingerprint as the real hosted roles. Source SQL is not grant evidence.
9. Deliver signed Polar events before, during, and after deletion and prove they rewind after a sweep, are ledgered, and never restore entitlement.
10. Configure a distinct worker bearer/cron caller, confirm it never places receipt secrets in URLs or logs, and verify concurrent invocations claim only one lease.
11. Complete the approved UI/copy/legal gates and owner acceptance before activation.

All erasure routes remain default-off. Confirmation and worker execution remain configuration-stopped until **all** hosted fence/session, bucket/quiescence, OTP-claims, Polar capability/error, Auth-readback, and grants checks above are proven and the three activation/readiness flags are deliberately set. No source-only or mocked pass authorizes those flags.
