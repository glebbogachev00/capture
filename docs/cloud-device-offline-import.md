# Device offline access and earlier-board import

Local implementation only. No deployment, provider writes, billing changes, or migration application.

## Offline permission

Settings → Capture Cloud contains **Keep available offline on this device**. It is off by default. Only a currently verified online account can enable it. The stored permission contains only the owner ID and `policy: "until-revoked"`. Existing expiry-only permissions are not silently upgraded: those users must explicitly opt in again online. It contains no token, email, or session cookie.

Local permission and server identity are separate states. An offline document can use its fixed account database, but cannot use `ownedFetch`. This blocks board uploads, photo transfers, AI, and transcription before a request is sent. The owner header remains a precondition on independently verified server identity.

A fresh document first tries the identity endpoint. It can use local permission only when fetch fails with a transport TypeError **and** the browser reports offline. HTTP errors, malformed responses, and online configuration/CSP failures do not select a remembered account. This conservative rule can refuse access during a network outage that the browser does not recognize as offline.

A connection event, focus, visible resume, or periodic check revalidates the same account. A different account or server rejection revokes the old document. The reconnect path pushes saved local edits even when the remote merge adds nothing. Initial verified Cloud opening also pushes local state, covering edits saved before an offline tab closed.

Logout, pending/failed logout, explicit authentication transitions, and server auth/precondition rejection remove permission. Other tabs revoke on those transitions. Disabling permission also retires an offline tab. Board and image bytes are not deleted.

### Approved duration policy — until explicitly revoked

Permission lasts **until you log out, switch accounts, or disable offline access on this device**. Downloaded boards and photos remain readable and locally editable after JWT/one-hour expiry, including cold reopens days later. The local grant never extends server authorization: offline identities carry no valid online expiry, and personal requests remain blocked until the same account is independently verified online again. Same-account verification renews only the in-memory online expiry; it does not create consent.

Capture **cannot learn about remote account revocation while offline**. A server auth/precondition rejection learned online revokes local permission; remote revocation cannot retroactively prevent disconnected local use. Settings explicitly explains this limitation. Physical airplane-mode, browser eviction behavior, and second-device recovery remain acceptance gates.

Anyone with the browser can open the permitted account locally while permission lasts. The control explains this shared-device risk. Local storage is not encryption against a person with filesystem or developer-tool access.

### Cached shell

`public/sw.js` v3 caches only generic `/app` and `/` navigation shells, public icons/manifest, and immutable assets. It excludes all `/api/`, authentication pages, callbacks, RSC payloads, redirects, errors, and arbitrary documents. Navigations fall back to their exact pathname, not an unrelated cached page.

The shell contains no account board, images, or verified identity. `OwnershipBoundary` still decides local access after JavaScript starts. An online navigation under an active service worker must have cached the shell and required assets. Next disables automatic registration in development, so the isolated browser acceptance explicitly registers the production worker. Browser cache eviction can still remove the shell or IndexedDB data. The opt-in does not claim to guarantee browser persistence.

## Explicit earlier-board import

After online sign-in, the entry gate checks database names for the legacy `capture` database. It does not open or preview that board to show the invitation. The invitation names the destination account ID. A checkbox confirms access before **Import my local board** is enabled. **Not now** persists in the account namespace. Settings → Restore retains an explicit import link.

The importer performs no HTTP requests and does not require a paid plan. The gate runs before board hydration and sync in the importing document.

1. Read the legacy `kv` store in a readonly transaction after consent.
2. Commit its full key/value snapshot to the verified account namespace.
3. Copy from that snapshot in one account transaction.
4. Commit board, copied photos, and completion receipt together.

A failed copy rolls back the entire copy transaction. The snapshot remains available for retry. A retry uses that saved source even if the original board later changes. The completion receipt prevents another copy, including concurrent attempts. No lock survives a crashed tab.

All incoming entity IDs and image IDs receive deterministic IDs within the persisted import batch. Allocation reserves destination IDs, image keys, and tombstones. References are rewritten structurally. Prose and dates are not rewritten. Same-ID different-content entries and photos therefore coexist. Identical built-in principles are not duplicated.

The importer spreads the full board and appends list fields rather than rebuilding a field list. Existing singleton selections, including the account profile, stay selected. The complete earlier profile and every original field remain in the recoverable snapshot. Imported Records carry provenance so the rolling live-history cap does not silently discard them. Imported wraps retain separate identity when they share a calendar day. Normal future intentional history resets still follow the existing history-epoch policy.

All referenced photo bytes are copied from the local snapshot, including attachment, cover, profile, and Record references. Missing bytes are reported. The importer never attempts shared-hub photo recovery. Missing references use the new namespace IDs and remain recorded in the snapshot.

An owner-specific generation changes before and after import. Older same-account documents must reload instead of overwriting the imported board from stale React state. Generation checks cover local transactions and network continuations. The account copy transaction aborts on revocation or verification suspension.

Settings offers **Download original snapshot**. The file contains a standard Capture backup with original board/photo bytes, plus the complete device key/value snapshot. The original database remains untouched.

The receipt says **Imported on this device**, not backed up. Cloud subscription, successful board sync, complete referenced-photo confirmation, provider storage/RLS, and second-device recovery are separate checks. Large imports remain subject to the existing Cloud request-size limit.

## Verification

Regression files:
- `src/lib/offlinePermission.test.ts`
- `src/lib/offlineShell.test.ts`
- `src/lib/legacyImport.test.ts`
- `src/hooks/useBoard.offline.test.ts`
- `src/components/OfflineSettings.test.tsx`
- `src/components/LegacyImport.test.tsx`
- Extended `src/components/OwnershipBoundary.test.tsx`

These exercise real React hooks and the IndexedDB adapter with fake-indexeddb. Provider responses are simulated. Prior (expiry-bounded implementation) checks passed: 150 test files, 1,240 tests, TypeScript, lint (one pre-existing unused `Frag` warning), and `git diff --check`. An isolated production build under `/tmp/capture-offline-production` passed without reading/copying environment files or touching shared build directories.

The production Chromium acceptance passed 16 assertions. It used real IndexedDB, real cached shell/assets, and disabled context transport. Provider responses and the cold page’s offline navigator signal were simulated. The latter was necessary because Playwright reported `navigator.onLine === true` after cached navigation while requests failed with `ERR_INTERNET_DISCONNECTED`. The app correctly refused fallback in that ambiguous case. No fallback rule was weakened. Physical airplane-mode acceptance is still required.

See `/tmp/capture-offline-import-browser/report.md`, `assertions.json`, and the screenshots for historical browser evidence.

### Persistent-permission follow-up verification

RED: the two new 2-hour/7-day storage regressions failed because the prior grant expired; the new Settings-policy assertion also failed before the copy change. GREEN: 150 files / 1,250 tests passed, including 7-day real-hook capture/edit/find/move/photo/reopen/same-owner-sync, expired-online-request gates, renewed expiry timer, disable/cross-tab disable, logout/pending, account mismatch/rejection, and no silent upgrade of earlier expiry-only consent. TypeScript and lint passed (the existing unused `Frag` warning remains). Server expected-owner and entitlement tests remain unchanged and green.

A fresh isolated production build at `/tmp/capture-persistent-offline-production` passed using a sanitized environment and no environment files. Chromium passed 16 assertions with real IndexedDB, PNG data, production assets, cached shell, and disconnected transport. The clock was advanced seven days on cold pages; auth/provider responses and the offline navigator signal were explicitly simulated. The downloaded board reopened, accepted a new capture, displayed its photo, reopened again, and uploaded only after same-account verification. Failed logout survived another offline reload. Existing import acceptance passed unchanged.

Current artifacts: `/tmp/capture-persistent-offline-browser/report.md`, `acceptance.cjs`, `assertions.json`, and screenshots. Settings consent and the seven-day cold board screenshots were visually inspected. No real provider, physical airplane mode, remote revocation, RLS, paid storage, or second-device recovery acceptance is claimed.
