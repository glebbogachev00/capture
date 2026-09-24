# What leaves your device, when, and to whom

This is the complete list. If something is not on it, it does not leave.
The code that could widen this list is guarded: provider failure logs are
sanitized (`src/lib/providers.ts`), and the build fails if private board
data enters the deployment trace (`scripts/check-trace.mjs`).

## Stays on the device

- **Your board** — actions, threads, intentions, principles, history,
  wraps, completion receipts — lives in the browser's IndexedDB.
- **Photos** are stored as bytes in the same database.
- The app works offline; nothing below is required to read or edit.

## Sent to the AI provider you configured (your keys)

The text of a capture is sent at the moment a model job runs, to whichever
provider your keys select (Groq, Cerebras, Mistral, Google, OpenRouter):

| When | What is sent |
|---|---|
| Sorting a capture | the capture's text, thread names and summaries |
| Dictating | the audio, for transcription and cleanup |
| Thread summaries | that thread's fragments (background, after a capture lands) |
| Daily wrap | the day's capture texts (background, once a day) |
| Tidy / untangle / judge | the texts being compared (only when you open Tidy) |
| Recall / answer a Search question | a precision-detected question and bounded selected excerpts (automatically after the query is stable and the on-screen disclosure is committed) |
| Text to speech | the reply being spoken, when a remote TTS fallback is configured |

Failure logs never contain this text. Generative-provider failures log only the
provider name, status code, error name, and a bounded message. Decisions
failures log only a fixed error name/code and optional status.

### Optional OpenRouter Decisions shadows (off by default)

Jev is not part of the chat-model fallback chain. It uses the separate
OpenRouter Decisions endpoint only when its dedicated flag is exactly `1` and
`OPENROUTER_API_KEY` is configured:

- `CAPTURE_JEV_THREAD_RERANK_SHADOW=1` runs after a successful thread/both
  sort. A pure-thread sort sends bounded `primaryText` when available and
  otherwise bounded reconciled `clean` text. A mixed `both` sort runs only
  with nonempty isolated `primaryText`, so it never substitutes the complete
  mixed capture. The request also includes at most 40 thread
  names/descriptions (120/700-character caps).
- `CAPTURE_JEV_JUDGE_SHADOW=1` runs after `/api/judge` has already sent the
  full original candidate batch to the existing generative judge and received
  its verdicts/reasons. It sends at most 14 candidates with bounded kind,
  source, target, and target-context fields (80/400/400/700 characters), using
  one independent Noul question per candidate.
- `CAPTURE_JEV_RECALL_SHADOW=1` runs only after `/api/recall` has authenticated,
  validated the existing bounded source snapshot, and completed its
  authoritative cited answer. One post-response Decisions request receives the
  question (500-character cap) and at most 12 excerpts (1,000-character cap
  each) under `source_N` labels. In parallel it classifies query intent, ranks
  every opaque source label plus `none`, and scores evidence sufficiency. It
  never writes answer prose or citations, changes source order, or skips the
  existing Recall model.

All three adapters replace structured local IDs with opaque
`thread_N`/`candidate_N`/`source_N` labels. The Recall adapter also omits the
structured source title/name, kind, timestamp/date, lifecycle state, navigation
target, target/fragment IDs, authoritative answer prose, and citations. Its
request body has no dedicated account-ID, session-ID, trace-metadata, or API-key
field and does not add images, board history, or learned rules.

Those are structured-field omissions only, not value-level redaction. The
bounded Recall question and excerpts are **not redacted**; after trimming and
clipping, they are sent as the person wrote them. Either string may contain
identifier-, title-, date-, state-, navigation-, account-, or session-like
values written as prose. The adapter does not detect or remove those values.

The shared server-only transport fixes the endpoint and timeout, makes one
no-retry request, and always injects this non-overridable provider policy:

```json
{
  "allow_fallbacks": false,
  "data_collection": "deny",
  "zdr": true
}
```

OpenRouter still retains request metadata, and its account-level Input &
Output Logging setting can retain content independently of this request. An
operator must exclude the key from that logging before enabling any shadow.
If privacy-eligible routing is unavailable, a request times out, or a response
is missing/malformed, that shadow is discarded. Thread filing, judge output,
and cited Recall behavior remain unchanged. There is no production Jev judge
prefilter, Recall source reorder, Recall model gate, or generative-call skip;
the calibration blockers are recorded in
`research/jev-judge-calibration.md` and
`research/jev-recall-calibration.md`.

Successful judge-shadow logs contain non-content aggregates only: candidate
counts, token count, and probability histograms. Thread-shadow logs add only
selection class/index, confidence, and sorter agreement. Recall-shadow logs
contain only source/citation counts, opaque source ranks/indexes, intent class,
probability buckets, authoritative status, token count, and comparison flags.
None contains question/note/candidate text, local IDs, keys, answer prose,
citations, or response bodies.

## Capture Cloud sync and complete backups

Capture Cloud is a separate, authenticated path from the single-owner hub
below. The server derives the owner from the Supabase session; the browser's
`X-Capture-Owner` header is only a fail-closed precondition. Board rows and
image publications are stored under that verified owner, and every browser
operation is tied to one immutable `OwnershipLifetime`.

Cloud image writes use a server-only admission path. After identity, lifecycle,
entitlement, ID, MIME, signature, and size validation, PostgreSQL atomically
reserves one physical object plus exact bytes under a database-owned per-owner
policy. It chooses the active fresh/legacy candidate bucket and generates the
owner/candidate path. The server secret client uploads only that path; browser
authenticated roles cannot INSERT candidate objects or publications directly.
Publication finalization binds the operation to digest/MIME/length, selects one
logical winner, and reads back the exact stored winner before acknowledgment.
Failed/losing/ambiguous candidates remain in the durable operation inventory and
consume quota. Lease expiry removes only the in-flight erasure block, not storage
capacity, until provider quiescence and exact absence are authoritative. See
`docs/cloud-image-admission.md`.

A v3 backup is assembled in the browser rather than in one long-running route:

1. Verify the current account and require it to match the document owner.
2. GET the authoritative board plus tombstones from `/api/cloud/board`.
3. Enumerate `referencedImageIds(board)`. Use validated local raster bytes when
   present; GET `/api/img/:id` for bytes missing or corrupt locally.
4. Validate PNG/JPEG/WebP/GIF signatures and canonical base64 for every id.
   If one image is absent or corrupt, no file is downloaded and the archive is
   never marked `complete`.
5. Serialize backup v3 with the exact board, tombstones, owner scope, and image
   map. No image bytes pass through the board route.

A Cloud v3 restore verifies the same owner encoded in the archive, reads the
current authoritative state, and merges through the existing sync rules. It
PUTs every immutable image first (a PUT validates the stored winner, unlike a
metadata-only HEAD), then PUTs `/api/cloud/board`, GETs it back, and only then
atomically commits board, tombstones, and images to that owner's IndexedDB.
An owner transition, failed image, failed board write/readback, or aborted local
transaction produces no success message. Image writes that precede a failure
remain unreferenced; the prior board remains the visible local board and a retry
is idempotent.

Account-erasure state narrows this recovery path deliberately. A merely
prepared, unconfirmed operation does not change access: the exact owner may
still perform quota-bounded board and image backup reads. Confirmation installs
the deletion fence atomically. From `polar` onward, ordinary reads and all
backup/export reads are denied by both route guards and restrictive board,
publication, and Storage SELECT policies. The only post-Auth read is the
bounded, content-free erasure receipt. See `docs/cloud-account-erasure.md` for
the admission, capability, provider-sweep, and hosted-activation contract.

Destructive authorization is stricter than ordinary Cloud authorization. The
server combines a live Supabase Auth `getUser()` response with signed
`getClaims()` data and requires the same owner UUID, same normalized confirmed
email, a non-empty `session_id`, and a timestamped email-OTP `amr` entry within
the configured window. Confirmation and every admitted account mutation
serialize on the same owner advisory lock. The worker then executes one leased
stage per request: Polar anonymizing deletion and typed-absence readback,
durable session-fence readback, allowlisted Storage API drain, app-row delete
and empty readback, Auth hard-delete and typed-absence readback, then a
content-free receipt. All source routes remain hidden until erasure is enabled;
confirmation and worker execution additionally require hosted-readiness and
Storage-inventory attestations. Prepare/status remain available with core
service configuration so a receipt is not stranded by provider unavailability.

See `docs/backup-v3.md` for the envelope and compatibility contract.

## Self-hosted sync, only if you turn it on

One hub holds the merged board so your devices converge. You choose where
it lives:

- **Tailscale (private):** the hub is a file on your own machine; nothing
  touches third-party storage.
- **Hosted (e.g. Vercel + Upstash):** the hub is a Redis store in your own
  account; the full board and photo bytes are stored there, readable by
  that account's credentials. Rotate the token if it ever leaks.

## Self-hosted trust boundaries

Who can read or change what, and what stands between them:

| Boundary | Crosses it | Guarded by |
|---|---|---|
| Browser → app server | every API call | `APP_PASSWORD` session cookie (HMAC, `__Host-` in production); playground closes the past-the-browser routes outright |
| App server → model providers | capture text (table above), plus the optional bounded Jev shadow payloads | your API keys; chat failures are sanitized to name + status + bounded message; Decisions requests lock no-fallback/no-collection/ZDR routing and log only safe aggregate/error fields |
| App server → hub (Redis) | full board + photo bytes on sync | the Redis token; anyone holding it can read the board, so rotate on any suspected leak |
| Device → device | nothing directly | devices only meet through the hub; merge is last-write-wins per item with tombstones |
| Build → deployment | code only | `scripts/check-trace.mjs` fails the build if board data enters the trace |

In self-hosted mode, the server holds no accounts and no database of its own:
it is a relay with one password. The two secrets that matter there are the
model keys (spend) and the Redis token (read the board). Capture Cloud instead
uses the authenticated owner boundary described above.

## Working toward

Local model support, so sorting and summaries can run without any text
leaving the machine.
