# Capture Cloud foundation

Status: implementation in progress on `feat/capture-cloud-foundation`. The disabled-by-default authenticated text-board boundary and Supabase migration exist locally. Browser sign-in, local bootstrap, offline retry, live RLS verification, export, deletion, images, and rollout remain unfinished.

## 1. Boundary and recommendation

Capture remains local-first. A person can capture, read, edit, export, and use Capture offline without an account. Cloud is an optional backup and sync service. It appears after the product has value. It does not gate the public playground or local use.

The first cloud release should support one person with one account and one board across devices. It should not include billing, teams, public profiles, referrals, social features, or a general admin system.

Recommendation: use Supabase Auth and Postgres for the first cloud data plane. Use Supabase Storage for private images through a storage adapter that keeps the current image protocol. Keep the existing local IndexedDB, merge functions, and image synchronization contracts. Put cloud access behind a feature flag and a small authenticated API boundary.

This is a hybrid at the Capture boundary, not a hybrid provider design. Supabase owns identity, tenant-scoped rows, revisions, and image objects. Capture keeps its existing local store and pure merge policy. The existing Redis, Blob, and disk adapters remain valid for the current single-user deployment. They do not become the multi-user cloud store.

Why this choice:

- Supabase Auth supplies user identity and session refresh. The current password cookie identifies only a deployment, not a person.
- Postgres gives transactions for account creation, revision append, tombstones, export, and deletion.
- Row-level security can enforce tenant isolation in the database. Redis and Blob would require every route to implement and preserve isolation correctly.
- Private Supabase Storage policies can bind image objects to the authenticated user. The current image route has no owner field.
- The first migration is bounded. The existing board remains one JSON document per user. Capture does not need a new table for every action, thread, or fragment.
- A single provider is simpler than Auth in one system, board data in another, and images in a third.

Supabase is not free of operational work. It adds migrations, local project configuration, session handling, RLS tests, and provider dependency. That cost buys a real identity and tenant boundary. Reusing the current adapters would reduce short-term code but would leave identity, isolation, deletion, and recovery as custom work.

## 2. Verified current behavior

The following facts come from the checked source at the audit commit.

- `src/app/api/sync/route.ts:45-75,78-146` exposes one GET pull and one POST push. The route validates a board and tombstones, then calls `getSync` or `pushSync`.
- `src/lib/syncStore.ts:45-57,112-163` persists one `SyncStore` document under the global key `sync.json`. The document contains one merged board, tombstones, and a revision.
- `src/lib/hubStore.ts:13-35,235-255` selects Redis, Vercel Blob, or local disk from deployment environment variables. The selected store is not user-scoped.
- `src/lib/auth.ts:1-10,56-74` defines a deployment-wide password session. The cookie is an HMAC of an expiry timestamp signed by the password. It does not contain a user identity.
- `src/proxy.ts:34-71` applies that cookie only when `APP_PASSWORD` exists. When the variable is absent, the gate is off. Playground mode separately closes routes that reach past the browser.
- `src/lib/sync.ts:26-35,44-65,134-188,293-299` defines the current merge contract. Items merge by id. Newer `updatedAt` wins. Tombstones suppress deleted items for 30 days. Thread fragments merge by fragment and home. History remains union-merged.
- `src/hooks/useBoard.ts:525-577` tracks the last hub revision and reconciles image ids. It downloads missing image bytes and uploads local bytes.
- `src/hooks/useBoard.ts:579-624,634-707` pushes and pulls the full logical board through `/api/sync`. A failed request leaves local state in place. A successful response is passed through `adoptHubState`.
- `src/lib/adopt.ts:43-56` merges a server response with the current local state before adoption. This protects captures made while a request is in flight.
- `src/app/api/img/[id]/route.ts:32-37,53-126` stores immutable image data under `img/<id>`. It validates a safe id and limits the request to 3,000,000 bytes. It does not derive an owner.
- `src/lib/storage.ts:1-10,47-85` stores the board, tombstones, and image bytes in one browser IndexedDB database. The current local board is therefore available without an account.
- `src/lib/backup.ts:21-44,87-106` defines JSON export with board data and optional image bytes. `restoreBackup` merges rather than replaces local data.
- `src/lib/playground.ts:17-32,35-44,124-137` disables sync and image routes in the public playground. The playground uses a local daily limit of 15 captures.
- `src/lib/playgroundUsage.ts:33-57` emits bounded events such as `capture_sorted`, `first_capture_sorted`, `capture_sort_failed`, and `trial_limit_reached`. It does not send raw note text.
- `package.json:24-39` includes Redis and Vercel Blob dependencies. It does not include a Supabase dependency.

The current sync design is a useful local merge engine. The global server document and deployment password are the boundaries that must change for multi-user cloud.

## 3. Minimal tracer bullet

Build the first vertical slice in this order:

1. Add a disabled-by-default Cloud capability flag.
2. Add Supabase Auth sign-in and sign-out using the provider session. Keep local use unchanged when Cloud is off.
3. Add an authenticated `GET /api/cloud/board` and `PUT /api/cloud/board` boundary for one account-owned board.
4. Derive the user id from the verified server session. Do not accept a user id or storage key from the client.
5. Store one current board snapshot per user and append one revision per accepted write.
6. On sign-in, merge the local board with the remote board by calling the existing `mergeSync` policy. Keep the merged result local if the network fails.
7. Add a small sync status and retry path. Do not block capture on cloud failure.
8. Add export and account deletion before enabling the feature for real users.

The first slice should not upload images. It should prove identity, tenant isolation, local-to-cloud merge, offline behavior, and recovery with text and tombstones. The next slice adds image upload and download under the same authenticated tenant boundary. This order keeps the first failure domain small while preserving the image requirement in the foundation.

## 4. Boundaries to preserve and boundaries to change

Preserve these modules and contracts:

- `src/lib/sync.ts`. Keep `SyncState`, tombstones, `mergeSync`, `mergeTombstones`, `stampChanges`, and the existing last-write-wins rules unless a concrete defect appears.
- `src/lib/adopt.ts`. Keep adoption against the board that exists when the response arrives.
- `src/lib/model.ts`. Keep the current `Board` shape and immutable image ids.
- `src/lib/storage.ts` and `src/lib/imgCache.ts`. Local IndexedDB remains the offline source of truth.
- `src/lib/backup.ts`. Extend it only when cloud export needs metadata or a version marker.
- The image client flow in `src/lib/imgSync.ts`. Replace the route target behind an adapter, not the immutable id behavior.

Change these boundaries:

- Replace `syncStore.ts` as the multi-user persistence boundary. It may remain for the existing single-user deployment, but Cloud must use a user-scoped repository.
- Replace deployment password identity for Cloud routes. The old password route must not grant access to arbitrary cloud rows.
- Split the current global `sync.json` concept into a user-owned board row and append-only revision rows.
- Make the image route require a verified user and map the image id to an owner before storage access.
- Add a server-side cloud repository and a session helper. Keep Supabase calls out of `useBoard`.
- Add a feature-aware cloud client in the hook. Local commit and merge must work when the client is absent, offline, or returns an error.

Follow the existing architecture rule in `docs/ARCHITECTURE.md:3-21`: routes call `lib`, and policy that needs tests belongs in `lib`, not in the large hook.

## 5. Minimal domain model

Use one account identity and one board per account in V1.

### `accounts`

- `id uuid primary key`, equal to the Supabase Auth user id.
- `created_at timestamptz not null`.
- `deleted_at timestamptz null`.
- `cloud_enabled_at timestamptz not null`.

The application must not create a second identity table that can disagree with Auth. This row exists for lifecycle state and deletion tracking.

### `boards`

- `user_id uuid primary key references accounts(id)`.
- `state jsonb not null`, containing the hydrated `Board`.
- `tombstones jsonb not null`, containing the current `Tombstone[]`.
- `rev bigint not null default 0`.
- `state_bytes integer not null`.
- `updated_at timestamptz not null`.
- `deleted_at timestamptz null`.

The JSON document is the smallest reversible representation. Do not normalize actions, threads, fragments, or ledger entries into separate tables until real query needs justify that cost. The board is a user-owned document, not a public feed.

### `board_revisions`

- `id bigint generated always as identity primary key`.
- `user_id uuid not null references accounts(id)`.
- `rev bigint not null`.
- `device_id uuid not null`.
- `operation text not null`, with `bootstrap`, `push`, `restore`, or `delete`.
- `state_hash text not null`.
- `state_bytes integer not null`.
- `created_at timestamptz not null`.
- `expires_at timestamptz null`.

Add `unique(user_id, rev)`. A revision is an audit and recovery marker, not a second merge engine. Retain revisions for a bounded period, such as 30 days, unless a user export is in progress. Do not store note content twice in revisions.

### `board_tombstones`

V1 can keep tombstones inside `boards.tombstones` because the current merge engine already treats them as one state. If independent retention or query needs appear, extract them into:

- `user_id uuid`.
- `kind text`.
- `item_id text`.
- `deleted_at timestamptz`.
- `expires_at timestamptz`.

Use `primary key(user_id, kind, item_id)` and keep the newest deletion. The first slice should not add this table unless database constraints make JSON validation insufficient.

### `images`

- `user_id uuid not null references accounts(id)`.
- `image_id text not null`.
- `object_path text not null unique`.
- `content_type text not null`.
- `byte_size integer not null`.
- `sha256 text not null`.
- `created_at timestamptz not null`.
- `deleted_at timestamptz null`.

Use `primary key(user_id, image_id)`. The object path must be generated by the server as `user_id/image_id`, not supplied by the client. The board still stores only the immutable image id. Storage holds bytes. The row holds ownership and metadata.

## 6. Authentication and tenant derivation

Use Supabase Auth with the official `@supabase/ssr` cookie pattern and PKCE. The browser client needs access to the refresh token to maintain its session, so do not claim or force these cookies to be HTTP-only. Use `Secure` in production and `SameSite=Lax` unless a tested authentication flow requires otherwise. Never cache authenticated responses or initialize a user-scoped Supabase client at module scope. The browser may start a sign-in flow, but it does not select the tenant.

For every Cloud route:

1. Create the server-side Supabase client inside the request handler and read its session cookies.
2. Verify identity with `getClaims()` for normal authorization. Use `getUser()` only where immediate server-side logout or revocation status must be confirmed.
3. Extract the subject/user id from the verified claims.
4. Reject the request with `401` when no verified user exists.
5. Use that id for every repository query and storage path.
6. Ignore any `user_id`, account id, object path, or storage key in the request body.
7. Return `404` for an image id that is not owned by the verified user. Do not reveal whether another user owns it.

The route may pass the verified user context to a repository. The repository must still require the user id as an explicit argument. Do not create a generic `getByKey(key)` API for user data.

Use Supabase RLS as the final authorization boundary. The application server must not bypass RLS with a service-role key for ordinary user reads or writes. Use a separate, narrowly scoped server-only deletion path only if Supabase requires it for complete account cleanup. Test that path as an administrative operation.

## 7. RLS and storage policy

For `accounts`, `boards`, `board_revisions`, `board_tombstones`, and `images`:

- Enable RLS.
- Permit select, insert, update, and delete only when `user_id = auth.uid()`.
- On `accounts`, permit a user to read and insert only their own row. Do not let a user change `id` or deletion state from the client.
- On `boards`, require `user_id = auth.uid()` in both the existing row and the new row. The API should use an upsert keyed by the verified user id.
- On `board_revisions`, permit insert and select for the same user. Do not permit update or delete from the client.
- On `images`, permit metadata access only for the same user. The API must check the row before issuing a signed download URL.
- For Storage objects, allow access only when the first path segment equals `auth.uid()`. Do not use public buckets or permanent public URLs.

Add database checks for non-negative byte sizes, bounded revision numbers, supported operation names, and a maximum board size enforced in the API before JSONB write. RLS is not a replacement for request size limits.

## 8. Anonymous-local migration and conflicts

Account creation must not replace the local board.

On the first authenticated cloud enablement:

1. Keep the current local board and local tombstones in IndexedDB.
2. Pull the account board. If it does not exist, treat it as empty.
3. Call `mergeSync({board: localBoard, tombstones: localTombstones}, remoteState)`.
4. Store the merged board and tombstones locally before reporting success.
5. Write the merged state as the first cloud revision.
6. Upload referenced local images after the board write. Image failure must not remove text or block offline use.
7. Mark the device as cloud-enabled only after the board write succeeds.

This preserves the existing merge semantics. New ids survive. Newer item timestamps win. Deletions travel through tombstones. Equal timestamps keep the current local-first behavior in `mergeList`, where an incoming item replaces only when its timestamp is greater.

Use a stable per-install `device_id` in local IndexedDB. It is an identifier for revision diagnostics, not an authorization credential. Include an idempotency key for each upload attempt. A retry with the same key must return the accepted revision or safely repeat the same merge.

If two devices write at once, the server transaction must lock or compare the current revision. The server reads the current state, applies the same merge policy, increments `rev`, inserts one revision, and updates `boards` in one transaction. A stale writer retries from the new state. Never replace the board with the request body.

If a cloud write fails, keep the local state and mark the sync as pending. Retry on a later local change, an online transition, or an explicit sync action. Do not retry forever in a tight loop. If a cloud read fails, show that local work remains safe and do not clear local data.

Clock skew is an existing limitation because merge ordering uses client timestamps. Measure it during implementation tests. Do not silently invent a new conflict policy in this foundation. If skew causes a real loss, make server-assigned logical ordering a separate decision.

## 9. Threat model and controls

- Cross-tenant read: a caller guesses another board or image id. Control with verified-session tenant derivation, user-scoped queries, RLS, and non-enumerating image responses.
- Cross-tenant write: a caller submits another user id or object path. Control by ignoring client ownership fields and generating all paths on the server.
- Forged identifiers: a caller submits path traversal or oversized ids. Control with the existing safe id grammar, UUID validation for device ids, server-generated object paths, and schema validation.
- Session theft: a stolen browser session can read and change that account. Control with the official SSR cookie pattern, secure production transport, short access-token lifetime with refresh rotation, sign-out, and session revocation. The refresh token must remain available to the browser-side Supabase client, so HTTP-only is not a valid control in this architecture. Do not log tokens.
- Oversized payloads: a caller sends giant JSON or image data. Control with byte limits before parsing where possible, parsed board size limits, image content-type checks, image byte limits, and per-user and per-IP rate limits.
- Enumeration: a caller probes account or image existence. Control with generic `404` responses and no email or note-content lookup endpoints.
- Deletion abuse: a caller deletes an account or board accidentally. Require an authenticated, explicit deletion action. Create export first or make the UI offer export. Make deletion idempotent and audit the operation without storing note text.
- Provider quota abuse: a caller uses Cloud as a relay. Control with per-user and per-IP limits, payload quotas, image quotas, and provider monitoring. Keep playground limits separate from account limits.
- Sensitive note contents: board state and images are sensitive. Keep them out of logs, analytics, error messages, URLs, traces, and metrics. Do not send cloud payloads to analytics. Encrypt in transit and use the provider's encryption at rest. Document that server-side storage is not end-to-end encrypted in V1.
- Failed provider operations: a partial image upload must not produce a board reference that is treated as complete. The image protocol is retryable and the board remains usable without image bytes.

## 10. Export, deletion, retention, and failure

Export must produce the existing Capture backup shape, including the board, tombstones, and all referenced images. Add a cloud export endpoint that streams one authenticated archive or returns a short-lived private download. Do not put the archive in analytics or a public URL.

Account deletion must:

1. Verify the current session again.
2. Mark the account as deleting so new cloud writes fail.
3. Export only if the user explicitly requested export.
4. Delete board rows, revisions, tombstone rows if present, image metadata, and private image objects for that user.
5. Revoke sessions.
6. Mark the account deleted or remove the identity according to the Auth provider workflow.
7. Return a clear result. Repeating deletion must be safe.

Retain active board state while the account exists. Retain revisions for 30 days for recovery, then delete them. Delete orphaned image objects with a scheduled reconciliation job. Do not retain note content after account deletion except in provider backups that the provider controls. State that provider backup expiry is not immediate and record the provider retention policy before launch.

If the cloud provider is unavailable, local Capture continues. The UI reports pending sync and gives an export path. If Auth is unavailable, the person can keep using the existing local board. If migration fails after local merge, do not mark cloud enablement complete. The next attempt repeats from local state and the current remote state.

## 11. Minimal value metrics

Collect only events needed to answer whether Cloud provides durable value:

- `cloud_signup_started`.
- `cloud_signup_completed`.
- `cloud_first_sync_succeeded`.
- `cloud_sync_succeeded` with board byte bucket and device count bucket.
- `cloud_sync_failed` with bounded reason: `auth`, `offline`, `quota`, `provider`, or `validation`.
- `cloud_image_sync_succeeded` and `cloud_image_sync_failed` with count and byte buckets.
- `cloud_returned_on_second_device`.
- `cloud_export_completed`.
- `cloud_delete_completed`.

Use an anonymous installation id before sign-in. After sign-in, use a pseudonymous account id only if needed for funnel analysis. Never send note text, board ids, image ids, email addresses, exact IP addresses, raw error messages, or full payload sizes. The existing playground events in `src/lib/playgroundUsage.ts` show the desired bounded-category pattern.

The success question is simple: did a person return on another device and recover the same board? Do not add broad engagement tracking before that question has an answer.

## 12. Independently testable implementation steps

1. **First vertical slice: identity and text board.** Add Auth session helpers, the Cloud feature flag, a user-scoped board repository, and authenticated GET/PUT routes. Test one user, two users, unauthenticated access, and local use with Cloud off.
2. **Transactional revision and retry.** Add revision compare-and-merge, idempotency keys, stale-writer retry, and bounded backoff. Test concurrent pushes and repeated requests.
3. **Local-to-cloud bootstrap.** Wire sign-in to merge local and remote state through `mergeSync`. Test empty remote, non-empty remote, local-only data, tombstones, equal timestamps, and an offline failure during migration.
4. **Offline and UI status.** Preserve local commits when cloud calls fail. Test reload, offline capture, reconnect, retry, and explicit sync.
5. **Image adapter.** Add user-owned image metadata, private object paths, upload/download authorization, and retryable image reconciliation. Test same image id from two devices, missing bytes, cross-user access, size limits, and concurrent create.
6. **Export.** Add authenticated cloud export and verify that the resulting backup restores into an empty local browser with images.
7. **Deletion.** Add account deletion and storage cleanup. Test repeat deletion, revoked session, failed cleanup retry, and no access after deletion.
8. **Metrics and limits.** Add the bounded event set, per-user quotas, and dashboards. Test that note content does not enter events or logs.
9. **Controlled rollout.** Enable the flag for internal accounts, then a small cohort. Compare second-device return and sync failure rates before widening access.

Each step should keep pure policy in `src/lib`, route logic in `src/app/api`, and the hook as a coordinator. Do not combine Cloud work with unrelated board refactors.

## 13. Required input from Gleb

No credentials are required for the architecture work, local mocks, or tests.

Gleb must provide or decide only at these points:

- Before Step 1: approval to create a Supabase project and use Supabase Auth, Postgres, and private Storage for user-owned Capture data.
- Before production configuration: the Supabase project URL and public client key may be added through the normal secret-management workflow. Do not send service-role secrets in chat.
- Before rollout: the account sign-in method and the initial cohort. Email magic link is the smallest default. OAuth can wait.
- Before launch: approval of the provider's data-processing and backup-retention terms, because V1 stores readable board data on the server.

Gleb does not need to provide Redis, Blob, or database credentials for local implementation. Use local Supabase mocks or a local Supabase stack. Do not request production credentials until the first vertical slice passes against mocks.

Open decision: whether Cloud V1 should expose email magic-link sign-in only or also one OAuth provider. Recommendation: magic link only until cross-device recovery works.

## 14. Acceptance tests

- A person can use Capture with Cloud disabled and no account. The board remains local and usable offline.
- An unauthenticated request cannot read or write any board or image.
- User A cannot read, update, delete, or infer User B's board or image through ids, paths, or request fields.
- The client cannot select an arbitrary tenant key. The server derives the tenant from the verified session.
- Account creation preserves all local actions, threads, intentions, history, tombstones, and profile data after bootstrap.
- A local delete does not resurrect after migration or a later pull.
- Two concurrent pushes converge under the current `mergeSync` semantics. Neither accepted local addition disappears.
- A capture made while a sync request is in flight survives adoption.
- An offline capture remains readable and editable. Reconnect retries cloud sync without a destructive reset.
- A failed image upload does not block board sync. A later retry restores the image.
- An image object is private, user-owned, immutable by id, and inaccessible to another user.
- A board and its referenced images export and restore into a clean local browser.
- Account deletion removes future access and schedules or completes removal of board, revisions, tombstones, and images.
- Payload, image, rate, and quota limits return bounded errors without logging note contents.
- Metrics contain no raw note text, image data, email address, or secret.
- The public playground remains account-free, local-first, and unable to reach the cloud routes unless explicitly redesigned later.

## 15. Feature flag and rollback

Use a server and client flag with a safe default of off. When off, the existing local path and current single-user deployment path remain unchanged. Do not make the public playground depend on Cloud.

Roll out in this order:

1. Deploy schema and policies without enabling the client feature.
2. Run route, RLS, merge, export, and deletion tests against a non-production project.
3. Enable Cloud for an internal allowlist.
4. Watch sync failures, second-device return, image failures, quota use, and deletion results.
5. Expand only after the acceptance tests pass on a deployed preview.

Rollback means disable the flag and stop new cloud writes. Do not delete local data. Keep export available. Existing cloud data remains intact and can be exported or removed through the deletion path. If the new repository fails, route Cloud reads and writes to an explicit error state rather than falling back to the global `sync.json` document. A silent fallback would risk cross-account data exposure.

Before any schema contract step, keep the old single-user adapter available. Do not migrate or delete the existing Redis, Blob, or disk data until the new tenant-scoped system has a verified export and rollback window.

## Further notes

The foundation is intentionally boring: one account, one board document, one merge policy, one private image namespace, and explicit escape hatches. The current board is already a durable domain document. The cloud layer should protect that property instead of turning every board item into a new SaaS entity.

Unknowns that need evidence during implementation are clock skew, realistic board size, image storage cost, Auth recovery behavior, provider backup retention, and the time required for full account deletion. None should block local-first development or the first mock-backed vertical slice.
