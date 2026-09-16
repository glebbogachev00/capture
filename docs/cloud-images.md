# Cloud image recovery — local implementation, remote acceptance pending

> Historical first implementation below. **Superseded for publication/rollout by
> [cloud-image-publication.md](cloud-image-publication.md).** The old same-key
> `upsert:false` protocol failed concurrent hosted acceptance. New writes use
> fresh candidates plus a durable digest-bound publication, NOT this old path.
> Stage 1 only closes admissions; stage 2 remains BLOCKED on provider-verified
> drain and legacy-preservation evidence. Historical test counts here are not
> evidence that the revised implementation is hosted-ready. Metadata HEAD is
> existence-only; GET/PUT acknowledgments validate bytes. Administrative erasure
> uses supported Storage API cleanup, never managed-table triggers or SQL deletes.

## Boundary and compatibility

`/api/img/[id]` keeps the existing HEAD / PUT `{src}` / GET `{src}` protocol.
With `CAPTURE_CLOUD=1`, all methods use the cookie-bound Supabase server client
(publishable key plus verified user identity, never a service-role client).
Every request requires a current `is_entitled` subscription whose
`access_expires_at` is in the future. Unlike the board test override,
`CAPTURE_CLOUD_REQUIRE_SUBSCRIPTION=0` does **not** unlock images: Storage RLS
must enforce the same paid boundary regardless of which API a caller uses.

Images are immutable raw raster bytes in private bucket `capture-images` at
`<verified auth user UUID>/<image ID>`. IDs are never accepted from request
ownership fields. Two users may use the same ID without sharing an object.
There is no read-through, copy, or fallback from the single-owner hub.
Self-hosted mode retains its existing storage and password gate; the public
site without Cloud and legacy playground still block images.

Responses are private/no-store. Anonymous requests return 401; unpaid requests
402; invalid IDs/payloads 400; oversize payloads 413; storage/config/entitlement
failures 503. HEAD returns 204 for present, 404 only for provider `NoSuchKey`.
The metadata-only `info()` call is deliberate: SDK `exists()` conflates some
400/404 errors. An unknown/legacy bare 404 fails closed instead of resending
photo bytes. Confirm the target Storage version emits `NoSuchKey` on absence.

PUT counts the actual stream (3,001,024-byte JSON envelope limit), limits the
data URL to 3,000,000 bytes, accepts canonical base64 PNG/JPEG/WebP/GIF only,
and checks raster signatures. These checks are not a full image decoder.
Storage receives at most 2,250,000 decoded bytes, explicit MIME, cacheControl
`0`, and `upsert:false`. Duplicate codes are acknowledged only after an
owner-scoped metadata read confirms the winner. Arbitrary provider failures
never mean duplicate success. GET also checks size/MIME/signature because
clients with a valid session can call Storage directly.

## Caller audit

- `useBoard.reconcileImages`: runs after successful text sync/poll; missing local
  bytes use GET and `imgSave`; locally held bytes use `ensureHubImage`.
- `ensureHubImage`: HEAD with no body, then PUT only on exact 404. 401/402/403,
  rate limits, and provider failures never trigger upload. Unsafe IDs are
  rejected before constructing URLs.
- `referencedImageIds`: action attachments, thread fragment attachments,
  `img:` thread covers, and `board.profile.imageId`; invalid IDs are filtered.
- `ThreadView` cover picker and `CaptureProfile` photo picker already use
  `shrinkFile` -> fresh ID -> `imgSave`. No alternate remote image store.
- Legacy profile localStorage migration already creates an immutable image ID
  and moves bytes through `imgSave`. Legacy non-raster/URL strings will remain
  local and be rejected by Cloud; reselect a supported photo to sync them.
- `useStoredImage`/image-cache listeners update profile/signature/cover consumers
  when recovered bytes arrive. Bundled/default profile URLs are not private
  uploaded photos and are not migrated by this change.
- Small images can bypass shrinking in existing `shrinkDataUrl`; unsupported
  formats or oversized originals stay local when Cloud rejects them.
- The existing IndexedDB board/image store and in-memory confirmed-ID set are
  browser/device-scoped, **not account-scoped**. This change isolates the server
  resource, not multi-account switching on the same browser. Do not claim
  shared-browser account isolation; use separate browser profiles for accounts.
  No account-switching/local-data migration redesign is included.

## Explicit remote setup (not performed)

1. Use the approved Supabase project, initially an isolated verification project.
   Provision bucket **via Storage API/dashboard**, not by modifying Storage SQL
   metadata. Exact `createBucket('capture-images', options)` options:

   ```js
   { public: false, fileSizeLimit: 2250000,
     allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] }
   ```

   Do not expose a public bucket while preparing policies. Audit existing
   blanket Storage policies before provisioning; do not upload user photos
   until restrictive policies are applied and verified.
2. Apply `supabase/migrations/20260913120000_capture_images.sql` after the existing
   board/subscription migrations. It validates the bucket configuration and
   requires `storage.allow_any_operation(text[])` and
   `storage.allow_only_operation(text)`; otherwise it aborts. Do not relax the
   policies to work around an old Storage version.
3. Policies constrain owner path, ID alphabet, live entitlement, and operations.
   Restrictive policies protect against unrelated permissive policies. Anonymous
   access, update/delete, signed download/upload links, listing, and copying are
   not granted. Only standard authenticated upload, download and GET info are
   allowed. No new app credentials or env variables are needed.
4. Verify the actual SQL/RLS with real session-bound clients before deployment.
   Local migration tests check static SQL contracts only; route tests mock the
   provider boundary and **do not** prove the deployed RLS or bucket settings.
5. Deploy only after approval and end-to-end acceptance. No deployment, commit,
   push, remote SQL, bucket provisioning, or env/secrets inspection was performed
   for this implementation.

## Required real second-context proof

Use non-sensitive fixture photos and two paid users A/B plus unpaid C.

1. In browser context A1, sign in as A and attach a photo, pick a cover, and pick
   a profile photo. Observe HEAD 404 -> successful PUT for each distinct ID;
   inspect exact Storage paths under A's UUID.
2. In clean context A2 with no IndexedDB/cache, sign in as A. Recover the board
   and all three images; visually confirm attachment, cover and profile/signature
   rendering. Compare bytes/hashes with A1. Reload both contexts twice: existing
   photos should use HEAD 204 and never send full PUT bodies again.
3. In separate paid context B, request A's known image IDs through the app. GET
   and HEAD must not expose A's object (B namespace absent => 404). PUT of the
   same ID may create B's independent object but must not change A's bytes.
   Injected slashes/path traversal must return 400 at the handler.
4. With direct Supabase clients, B must fail to info/download/insert/upsert,
   copy/move/delete, or sign A's paths. A must also fail to overwrite/delete or
   sign download/upload URLs for A's own objects. Verify unrelated buckets still
   behave as before. Check MIME and size enforcement on direct uploads.
5. Anonymous, unpaid, expired/revoked contexts must fail GET/HEAD/PUT at the app
   and direct Storage access. Revocation must apply on subsequent requests;
   previously downloaded local photos intentionally remain local.
6. Exercise duplicate concurrent uploads; exactly one stored object, immutable
   winner, both clients eventually recover it. Simulate missing bucket, denied
   RLS and provider failure; HEAD must not incorrectly trigger an upload loop.
7. Recovery requires a device still holding the original bytes to sync them.
   Images lost from every device and never uploaded to Cloud cannot be recovered
   from IDs alone. Do not import the non-tenant-safe shared hub automatically.

## Local verification

- RED/GREEN cycles observed for anonymous/unpaid denial, tenant recovery,
  validation, duplicate formats, corrupt downloads, SQL policy contracts,
  proxy enablement, and unsafe client IDs.
- Targeted regression set: **16 files / 160 tests passed** (images, Cloud board,
  provider/subscription, proxy/playground, useBoard sync, profile/signature).
- Full `npm test`: **137 files / 1170 tests passed**.
- `npx tsc --noEmit --incremental false`: passed.
- `npm run lint`: passed with one pre-existing unrelated unused `Frag` warning
  in `src/lib/fragOps.ts`. No changes made to that work.
- `git diff --check`: passed. No build run while the verification server is live.

## Authoritative API references checked

- Next installed `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`:
  async route params, supported HEAD/GET/PUT, dynamic request handling.
- https://supabase.com/docs/guides/storage/security/access-control
- https://supabase.com/docs/guides/storage/uploads/standard-uploads
- https://supabase.com/docs/guides/storage/debugging/error-codes
- https://supabase.com/docs/guides/storage/schema/helper-functions
- https://supabase.com/docs/guides/storage/schema/design — Storage metadata is
  read-only; provisioning uses API/dashboard, migration adds only policies.
- https://github.com/supabase/storage/blob/master/src/http/routes/operations.ts
- https://github.com/supabase/storage/blob/master/src/storage/database/pg.ts —
  standard upload permission insert does not require SELECT RETURNING.
- Installed `@supabase/storage-js` implementation: `info()` preserves error codes,
  `StorageApiError.code` contains modern service codes; download returns Blob.
