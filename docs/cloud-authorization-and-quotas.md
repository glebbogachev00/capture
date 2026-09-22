# Capture Cloud authorization and owner quotas

Internal operations note. This is not public product, pricing, privacy, or legal copy.

## Request boundary

When `CAPTURE_CLOUD=1`, every managed model/provider route runs the shared server-only guard before reading a request body, applying the secondary in-memory IP limiter, or calling a provider. The guarded inventory is pinned by `src/lib/managedAiAuthorization.test.ts`:

- Sort, Distill, Group, Intention, Judge, Organize, Recall, Summarize, Untangle, and Wrap
- Transcription, including its local/Groq and cleanup paths
- TTS availability and synthesis, including local Kokoro and Edge fallback

The same guard protects ordinary Cloud board GET and PUT with separate quota
scopes. A third `backup_read` scope protects explicit exact-owner board/image
recovery reads and deliberately skips billing entitlement so an owner can leave
or restore the service after expiry. It does not apply to board/image writes or
managed AI. PUT still reads at most 2,000,000 bytes and retains the existing
optimistic read/merge/write loop after authorization.

The guard requires, in order:

1. ready Cloud server configuration;
2. identity verified from server-side claims;
3. an exact `X-Capture-Owner` match;
4. a non-erasing account whenever an account-lifecycle adapter exists;
5. current paid entitlement when `CAPTURE_CLOUD_REQUIRE_SUBSCRIPTION` requires one;
6. an atomic durable owner-quota admission.

A missing dependency, malformed quota response, database error, or invalid quota configuration returns a fixed private/no-store 503. Denials contain only fixed error strings and never provider, database, identity, or request-body content. Quota denial is a fixed 429 plus `Retry-After`. The old per-IP limiter remains after this boundary as a secondary instance-local defense.

Non-Cloud deployments preserve their existing behavior. This is what keeps anonymous managed AI possible for the separately deployed playground while preventing it on the public Cloud host.

## Durable quota defaults

Defaults are intentionally explicit and conservative. Policy is stored in a database-owned table that authenticated clients cannot read or modify. Operators change it only through a reviewed migration; request-time environment or RPC arguments cannot weaken it.

| Scope | Default | Window |
| --- | ---: | ---: |
| All managed AI/provider routes combined | 200 requests | 86,400 seconds |
| Cloud board GET | 720 requests | 3,600 seconds |
| Cloud board PUT | 240 requests | 3,600 seconds |
| Explicit owner backup board/image reads | 2,000 requests | 3,600 seconds |

Migration `20260921200000_cloud_owner_quotas.sql` stores one current fixed-window counter per authenticated owner and scope. The RPC derives ownership from `auth.uid()` and accepts only a scope. Limits and windows come from `capture_cloud_quota_policies`, which has no browser-role privileges. `INSERT ... ON CONFLICT DO UPDATE ... WHERE` admits and increments in one PostgreSQL statement, so concurrent serverless instances cannot exceed the configured owner limit. Authenticated clients receive RPC execution only and no direct table privileges.

Migration `20260921210000_cloud_backup_reads.sql` upgrades already-provisioned
quota constraints/policy rows and splits image SELECT from INSERT RLS. Exact-owner
publication/Storage reads no longer depend on billing, while publication and
Storage inserts retain restrictive current-entitlement policies. Fresh image
activation is re-fingerprinted and re-verified in the same transaction.

Image physical capacity is a separate reservation quota, not a request-rate
scope. Migration `20260922200000_image_storage_admissions.sql` keeps its policy
service-only and admits exact bytes before Storage: 256 objects and 576,000,000
bytes by default, derived from 256 × the existing 2,250,000-byte image ceiling.
Neither browser RPCs nor route payloads can supply limits. Published and losing
candidates remain accounted until exact provider deletion/readback; lease expiry
alone never returns capacity. See `cloud-image-admission.md`.

## Verification

`npm run check:launch-hosted` includes:

- shared-guard unit and denial-order tests;
- static discovery/coverage for every model/provider route;
- board quota and pre-body denial tests;
- migration contract checks;
- a disposable socket-only PostgreSQL run with 40 simultaneous admissions, owner/scope isolation, reset behavior, and permission/input rejection.
- disposable fresh/legacy image-admission upgrades plus concurrent object/byte
  reservations, direct authenticated INSERT denial, stale-lease retention, and
  account-erasure inventory/readback refusal when provider authority is unproven.

The disposable SQL runner does not read environment files, open a TCP listener, or contact hosted services.
