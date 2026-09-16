# Cloud account ownership boundary

## Current status

**Device-feature update:** Explicit offline opt-in and consented earlier-board import are now implemented locally. See [the current device contract](cloud-device-offline-import.md). The historical baseline below predates those features. Its statements that all offline reopening and legacy recovery are deferred no longer describe the current code. The approved local permission now lasts until logout, account switch, or explicit disable on that device; online verification still expires independently. Remote revocation cannot be learned offline. Physical PWA and live-provider acceptance remain outstanding.

**Implemented locally; not deployed.** The original four exposure regressions now
pass without skips or expected-failure markers. No environment/credential files,
live accounts, remote writes, migration application, commits, pushes, or builds
were used. Pre-existing dirty work was preserved. There was concurrent unrelated
navigation work during verification; its remaining failures are recorded below.

## Installed contract

- Both board entry points (`/` on a personal instance and `/app`) explicitly pass
  server Cloud mode into `OwnershipBoundary`. No board child mounts until the
  Cloud identity endpoint succeeds. Network/configuration/malformed failures do
  not become anonymous or self-hosted access. An auth transition during the
  initial verification invalidates the pending result before hydration.
- `/api/cloud/identity` uses independently verified Supabase claims. It returns
  only `{owner, expiresAt}`, never session material. An explicit missing session
  grants anonymous local storage. Invalid/expired claims and operational errors
  stay locked. Account expiry is bounded by both verified JWT expiry and one hour.
- `OwnershipLifetime` is installed once per document and cannot switch owners or
  be regranted after revocation. A new owner requires a full document navigation.
- Every IndexedDB key is covered: board, images, drafts, tombstones, dismissed
  proposals, forgotten rules, snapshots, and quarantined corrupt data.
  - Self-hosted: existing `capture` database.
  - Cloud signed out: `capture-cloud-v1-anonymous`.
  - Cloud signed in: `capture-cloud-v1-account-<encoded verified owner>`.
- The unknown legacy `capture` database is never opened by Cloud consumers,
  assigned to the next account, or automatically uploaded. Legacy localStorage
  profile/name/photo adoption is also disabled on Cloud. Nothing is deleted.
- Logout/login announces a non-secret auth transition to other tabs. Storage
  events, expiry, and HTTP 401/412/428 revoke the document, abort requests and
  queued IDB transactions, dispose queued sync, and remove account content.
  Cached image bytes become inaccessible and are cleared from memory.
- Hidden/resumed pages and periodic checks reverify identity. A real hidden-page
  transition or persisted BFCache pageshow keeps the board and portals hidden
  until same-owner verification succeeds. Ordinary focus/online/non-persisted
  pageshow on an already-visible, unexpired online view keeps that same board
  visible, mounted and interactive under its existing `active` lease, just like
  the timer poll. The existing pending-verification flag independently denies
  app clipboard/export/share disclosures and holds network requests/readback.
  No extra presentation state or checking banner: local drafts, inline edits,
  focus and open dialogs need not reset or pause. `checking` (hidden + inert)
  remains the actual privacy gate for hidden/resume, BFCache and offline checks;
  ordinary events cannot unhide it. Neither path grants or extends a lease until
  same-owner verification succeeds.
  Local work remains pinned to the same database. A different identity or failed
  check irreversibly revokes it. Expiry and disclosure guards remain effective
  even if timers are throttled. The separately consented offline-local permission
  is unchanged. Bootstrap without a verified identity still blocks all children.

  **Visible-check privacy tradeoff:** An already-visible account view may remain
  readable and locally editable until the check reports a cookie-only account
  change. Browser/OS copying of already-visible selected text is not controlled
  by app export guards (nor was it during existing background polls). It does not
  receive permission for new disclosures or network work. This explicitly does
  not relax the hide-on-away/resume policy. The phone's reported ~two-minute
  event is not traced: source proves these foreground triggers are possible,
  not which event occurred. The public identity route caps the lease at
  `3_600_000 ms` and the verified JWT expiry, not a two-minute timer; polls remain
  `30_000 ms`. The actual phone token's remaining lifetime was not inspected.
  This local candidate has not been deployed or visually accepted on the phone.

  **Polling privacy tradeoff:** Unlike the original hide-on-every-check policy,
  already-verified content and lease-authorized operations remain available
  during routine polling. Cookie-only account changes with no local transition
  signal are learned on the poll response, not on request start. This is bounded
  by the existing lease (server JWT expiry capped at one hour), not a new grace
  period. Local logout/cross-tab signals and observed auth errors revoke at once;
  server owner preconditions still protect network access. A stricter requirement
  to hide before learning the poll result is incompatible with no-flicker polling.
  This local change awaits Preview/physical-phone acceptance; it does not explain
  the separately observed historical intermittent bootstrap 503.
- Fetch completion AND asynchronous body consumption are guarded. Delayed pull,
  image HEAD -> PUT, AI response, and file restore continuations cannot regain
  access after revocation. Export/share continuations also check the lifetime.
- Cloud board, sync compatibility, and image requests must include
  `X-Capture-Owner`. Missing headers get 428; mismatch gets 412, before data or
  entitlement access. This only RESTRICTS independently authenticated identity;
  repository keys and image paths still come solely from the verified server
  identity. Cached old clients fail closed. Account responses remain no-store.
- Anonymous sync/image traffic is blocked locally. The separate anonymous board
  remains usable and persistent after successful signed-out verification.

## Call-site coverage

The only production IndexedDB opener is `storage.ts`. Its callers are
`useBoard.ts`, `Capture.tsx`, and `imgCache.ts` (the model has an empty legacy
import). All use the same immutable document lifetime.

Private-data browser HTTP calls in `useBoard`, `Capture`, `imgSync`, recording,
speech, and bug reporting use `ownedFetch`; subscription status does too for
signed-in documents. Anonymous allowance does not make an unauthorized status
request. Version checks and auth/billing operations do not carry board data and
retain their separate protocols. Login/logout publish the lifetime transition.
There are no production `sendBeacon` or `XMLHttpRequest` bypasses in `src`.
The service worker already excludes `/api/` from caching.

## Verification

Latest targeted command (all passing):

```sh
npx vitest run --maxWorkers=1 \
  src/hooks/useBoard.accountIsolation.test.ts \
  src/components/OwnershipBoundary.test.tsx src/lib/ownership.test.ts \
  src/lib/cloudIdentity.test.ts src/lib/cloudOwnership.test.ts \
  src/lib/cloudBoard.test.ts src/lib/cloudImageRoute.test.ts \
  src/lib/cloudRoute.test.ts src/lib/imgCache.test.ts \
  src/lib/imgSync.test.ts src/lib/pushGovernor.test.ts
```

**11 files / 118 tests passed.** Includes real hook + fake-indexeddb regressions:
A -> B -> A board/image preservation, anonymous persistence/non-upload, unknown
legacy non-adoption, bootstrap gating and bootstrap races, immediate logout
revocation, stale pull, stale AI, delayed file restore, queued push/write, delayed
JSON, HEAD -> PUT, expiry, other-tab events, resume identity mismatch, and
server old-client/missing/mismatched-owner rejection for board/sync/images.

Full suite, serialized to avoid timing contention:

```sh
npx vitest run --maxWorkers=1
```

**140 files passed / 2 failed; 1,203 tests passed / 2 failed (1,205 total).**
All ownership and performance tests pass. The two failures belong to concurrent
navigation changes, not this implementation; they expect no navigation button
but the changed `SiteNav` now supplies “Open navigation”:

- `src/components/CopyPrompt.test.tsx:170`
- `src/components/PublicThreadArticle.test.tsx:35`

Those files and `SiteNav` were not modified by this ownership work. The default
parallel full run also encountered timing failures under shared CPU load; no
performance threshold or timeout was loosened.

- `npx tsc --noEmit --incremental false`: exit 0.
- `npm run lint`: exit 0; only pre-existing unused `Frag` in `src/lib/fragOps.ts`.
- `git diff --check`: exit 0.
- No production build against the active dev directory.

## Exact files changed by this implementation

```text
docs/cloud-account-isolation-blocker.md
src/app/Capture.tsx
src/app/page.tsx
src/app/app/page.tsx
src/app/api/cloud/identity/route.ts
src/components/CaptureProfile.tsx
src/components/CloudLoginForm.tsx
src/components/ConfirmDelete.tsx
src/components/OwnershipBoundary.tsx
src/components/OwnershipBoundary.test.tsx
src/components/ReportBug.tsx
src/hooks/useBoard.ts
src/hooks/useBoard.accountIsolation.test.ts
src/hooks/useCaptureLimit.ts
src/hooks/useOwnedState.ts
src/hooks/useRecordedDictation.ts
src/hooks/useSpeech.ts
src/lib/cloudBoard.ts
src/lib/cloudBoard.test.ts
src/lib/cloudIdentity.test.ts
src/lib/cloudImage.ts
src/lib/cloudImageRoute.test.ts
src/lib/cloudOwnership.test.ts
src/lib/cloudRoute.test.ts
src/lib/imgCache.ts
src/lib/imgSync.ts
src/lib/ownerPrecondition.ts
src/lib/ownership.ts
src/lib/ownership.test.ts
src/lib/publicSite.test.ts
src/lib/pushGovernor.ts
src/lib/storage.ts
```

## Remaining release acceptance / deliberate limits

- Resolve the unrelated navigation assertions in their owning workstream, then
  obtain a completely green full suite against a stable tree.
- Run isolated real-browser/Supabase two-account and two-tab tests with held
  requests, expiration, logout, and fresh/cached PWA reloads. Current evidence
  uses real React/hooks/IDB adapter with fake-indexeddb and simulated HTTP/auth;
  it is not a claim of live-browser or real-provider verification.
- Separately validate the pre-existing image RLS migration/provider behavior
  with isolated accounts before deployment. No migration was applied here.
- Explicit legacy recovery and voluntary anonymous-to-account import remain
  deferred product work. No automatic migration is installed.
- New Cloud documents and resumed documents cannot expose local account data
  when identity verification is unavailable. Offline reopening is intentionally
  locked rather than guessing identity. Existing cached pre-boundary JavaScript
  must be updated: server rejection prevents its Cloud transfers, but the server
  cannot rewrite an already-running old client's local rendering logic.
