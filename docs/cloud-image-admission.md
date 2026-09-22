# Capture Cloud image/storage admission and quota ledger

Internal engineering contract. This is not public pricing, retention, or product copy.

## Source boundary

Migration `20260922200000_image_storage_admissions.sql` is additive and runs only after active image publication and account-erasure migrations. It supports both explicit publication modes:

- `legacy-cutover` → `capture-image-candidates`
- `fresh` → `capture-image-candidates-fresh-20260914`

The route requires both `capture_image_publication_ready()` and `capture_image_admission_ready()`. Missing schema, policy drift, mixed mode/bucket, missing server secret, malformed RPC output, or provider ambiguity returns a private/no-store 503. Fresh mode still ignores the old bucket. Legacy mode still serves frozen legacy objects and refuses to shadow a legacy logical ID. Backup image reads remain exact-owner, lifecycle-fenced, quota-bounded, and billing-independent; ordinary reads and every write remain entitled.

## Admission protocol

Only the server route may start an image write:

1. Verify signed identity, exact `X-Capture-Owner`, non-erasing lifecycle, entitlement, canonical logical ID, MIME, raster signature, canonical base64, and decoded size at or below 2,250,000 bytes. The longest supported data-URL prefix plus canonical base64 yields an exact 3,000,023-byte source ceiling; the exact JSON wrapper yields a 3,000,033-byte request ceiling. This admits exactly 2,250,000 decoded bytes for PNG/JPEG/WebP/GIF and denies 2,250,001 without widening other request bodies.
2. Call the service-only `reserve_capture_image_storage` RPC. PostgreSQL takes the owner lifecycle lock, rechecks entitlement/fence/readiness, selects the active bucket from protected publication state, atomically reserves one object plus exact bytes, creates random operation/lease/candidate UUIDs, and returns the generated `<owner UUID>/<candidate UUID>` path. The request cannot supply a path, bucket, lease, object limit, or byte limit.
3. Upload through the server-only Supabase secret client to that exact generated path with `upsert:false`. Authenticated browser roles have no publication INSERT privilege, their permissive candidate INSERT policies are removed, and the additional restrictive Storage policy denies direct INSERT into all three Capture image buckets.
4. Download and validate the exact candidate bytes. A lost upload response is recoverable only when this exact readback matches reservation digest, MIME, and length. Typed `NoSuchKey` after an upload call does **not** return capacity: an already-admitted completion may still land. Every post-invocation failure idempotently marks the operation `abandoned`, keeps its physical quota, and retains the owner-bound work admission until lease expiry; unknown provider errors do the same.
5. Record upload, then call service-only `finalize_capture_image_storage`. A publication trigger requires the exact durable operation context. `INSERT ... ON CONFLICT (user_id,image_id) DO NOTHING` picks one winner. The operation becomes `published` or `abandoned`; both continue to consume physical-object quota because both candidate objects may exist.
6. Read the durable publication row and exact winner bytes again before returning either `stored:true` or `stored:false`. A dangling or changed winner is unavailable, never 404 and never permission to overwrite.

Finalize and release are idempotent for the same operation/lease. A crash before upload leaves a durable reservation; a crash after upload leaves an enumerable candidate; a crash after publication is recovered by the publication lookup. Duplicate logical IDs, independent serverless instances, response loss, and publication collisions cannot produce two logical winners.

## Server-owned limits

`capture_image_storage_policy` is private service state. Browser callers cannot read or change it and no RPC accepts caller-supplied limits. The source default is deliberately conservative and derived from the existing per-image ceiling:

- maximum physical objects per owner: **256**
- maximum accounted bytes per owner: **576,000,000** (`256 × 2,250,000`)
- maximum bytes per object: **2,250,000**
- upload admission lease: **120 seconds** (bounded by SQL to 60–600 seconds)

`capture_image_owner_usage` reserves object and byte capacity in the same transaction that creates an operation. Concurrent requests use one `INSERT ... ON CONFLICT DO UPDATE ... WHERE` and can never cross either policy limit. Existing durable publication winners are seeded into the ledger on upgrade. Older losing/orphan Storage objects are grandfathered provider inventory: no new browser admission can add more, but hosted inventory must enumerate them for erasure.

A quota denial is HTTP 507 and occurs before Storage. The 256-object/576-MB defaults are an internal launch safety choice, not approved pricing or public allowance. Product/operations must either approve them or change them through a reviewed migration before public launch; no environment or request override exists.

## Lease expiry and reclaim

An active image operation also creates an `image_upload` external-work admission, so erasure confirmation and upload admission serialize on the same owner lock. Finalize/release removes it. A crash leaves it until the 120-second lease boundary.

At expiry, a later reservation may mark the stale operation `abandoned` and remove only the expired work admission. It does **not** return object or byte capacity: the provider may still complete an already-admitted upload. `claim_capture_image_reconciliation` takes the same owner lock as upload, release, finalization, and erasure; it returns the claimed source state plus incremented operation version. Completion requires that exact state/version/lease tuple under the owner lock. Every competing transition increments the operation version and clears the reconciliation lease, so a stale worker cannot release/delete/publish over newer state or decrement owner usage twice. `reconcile_capture_image_operation` remains default-closed by `stale_reclaim_enabled=false` and raises `provider inventory and quiescence are not attested`. Do not enable it based on a quiet list, HEAD/GET absence, route timeout, TUS expiry alone, SQL lock, or sleep.

## Erasure inventory

`capture_image_operation_inventory` enumerates every non-released/deleted service admission, including published, losing, uploaded, stale, and abandoned candidates. The erasure storage stage must:

1. require an attested authoritative provider inventory/quiescence boundary;
2. enumerate ledger paths first;
3. remove each exact path through Storage API;
4. read back typed exact-path absence;
5. mark the ledger operation deleted;
6. prove no ledger candidate remains;
7. independently paginate and drain the exact owner prefix in every approved Capture bucket to catch pre-ledger or provider-only objects;
8. exact-read each removed path and finish with another authoritative inventory assertion.

The production adapter currently returns `false` from `providerInventoryIsAuthoritative()`, and the worker route remains hard-stopped. Therefore source cannot falsely advance the storage stage. Ledger coverage does not prove that a pre-admitted privileged provider completion cannot appear after final zero readback.

## Precise hosted attestation blocker

The migration supplies the fail-closed restrictive policy and removes authenticated candidate/publication INSERT privileges, but local PostgreSQL cannot prove the managed Storage service's permission-probe/finalization contract. Before hosted activation, prove against the exact deployed Storage version that:

1. direct authenticated standard, resumable, signed, copy/move, and metadata INSERT routes cannot admit any of the three Capture image buckets after policy commit;
2. service-secret upload to a DB-generated reserved path still works;
3. there is a provider-documented bound or drain procedure covering every request admitted before policy/quota/erasure fence commit, including finalization and cleanup jobs;
4. after that drain, paginated list plus exact-path info/download is complete and stable enough to authorize stale quota reclaim and erasure completion;
5. active fresh and legacy publication readiness/fingerprint/grants remain correct after the additive migration, including the exact restrictive `capture_image_app_only_insert` command, authenticated-only role, null `USING`, normalized `WITH CHECK`, singleton-policy ACL/default row, and enabled publication-admission trigger definition/body;
6. the hosted race batch still returns one winner, one loser, and stable exact winner bytes.

If the provider cannot supply and pass items 1–4, leave stale reclaim disabled and the account-erasure worker hard-stopped. Do not claim public Cloud erasure or bounded physical storage completion from source tests alone.

## Local executable evidence

`npm run check:launch-hosted` now includes:

- route races, exact 2,250,000/2,250,001-byte boundaries for every supported MIME, quota denial, generated paths, typed-absence release, ambiguous-failure retention, lost-response recovery, exact winner readback, fresh/legacy behavior, and lifecycle denial;
- migration/grant/default-limit contracts plus executable policy, ACL, trigger/body, singleton-row drift and re-attestation checks;
- disposable active legacy and active fresh upgrade/RLS runs, including winner seeding, direct authenticated INSERT denial, and fresh admission-fingerprint drift closure;
- disposable account-erasure PostgreSQL concurrency with the source-default object limit, executable per-object byte denial, duplicate IDs, idempotent finalize/release, operation-version/state CAS, deterministic reconcile-vs-release and reconcile-vs-erasure deletion interleavings, aggregate usage/underflow assertions, stale lease retention, default-closed reclaim, and app-row cleanup;
- worker tests that require both ledger inventory and provider readback and refuse non-authoritative provider inventory.

These tests use local synthetic PostgreSQL/Storage boundaries only. They do not clear the hosted attestation blocker.
