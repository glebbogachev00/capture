# Planned routing and Unsorted safety sprints

Status: isolated implementation track; P1–P5 internally source-verified
Branch: `feat/planned-routing-validation`
Baseline: `381b114`
Owner: Gleb

## Outcome

Move Capture toward a 10/10 sorting experience without changing the protected daily local or Cloud baseline until the complete candidate is accepted.

The architectural rule is:

> Saving is local and immediate. AI sorting is a separate, optional step.

Unsorted is Capture's durable intake and recovery layer, not an error bucket. Planned routing may improve automatic organization, but it must never delay or endanger the original capture.

## Protected behavior

Keep these intact throughout the track:

- the owner-accepted recovery router;
- R4 full-example semantic corrections, never phrase rules;
- exact raw capture and attachment preservation;
- local and Cloud ownership boundaries;
- existing Actions, Threads, Intentions, Record, Undo, images, reload, and sync behavior;
- the last verified daily-use deployments.

Do not transplant the rejected semantic overhaul, add lexical routing, expose validator/schema errors, or merge an incomplete sprint into the protected baseline.

## Authority and state invariants

Every capture receives one immutable `captureId` before any model request.

The persisted intake state must distinguish at least:

- `saved_local` — original text and attachments are durably stored;
- `pending_sort` — a bounded automatic sorting attempt may settle it;
- `manually_sorted` — the person selected the result; this is authoritative;
- `automatically_sorted` — one validated model plan settled it.

The names may differ in code, but the transitions must remain explicit and testable.

Rules:

1. Capture first persists the original locally as Unsorted. Only after persistence succeeds may the composer clear or a saved receipt appear.
2. Sorting happens separately and must not block the rest of the app.
3. A model result may commit only while the same `captureId` is still pending.
4. A manual result wins permanently over an in-flight or delayed model response.
5. Each `captureId` may settle once. Retries, reloads, sync, and late responses cannot create duplicate Actions, Threads, fragments, or Intentions.
6. The model owns semantic decomposition and destination meaning. Deterministic code enforces persistence, state transitions, validation, idempotency, authorization, and explicit user choices only.
7. Pending captures survive offline use, reload, browser closure, provider failure, malformed output, and—after local state syncs—device switching.
8. Internal schema, validator, source-ownership, and provider diagnostics never appear in public UI.

Candidate failure copy for the owner-visible slice:

> Saved here. Sorting is unavailable right now.

## Sprint P1 — Pure routing plan and validator seam

Product outcome: the model proposes a complete plan before anything writes to the board.

Scope:

- decompose ordinary captures into model-declared atomic items;
- represent Actions, developing thoughts, Intentions, supporting context, and deadlines once;
- allow each thinking item to name multiple existing destinations or one genuinely new destination;
- validate exact source coverage, destination identity, duplicate settlement, structured deadline ownership, and no invented items;
- retry malformed or invalid planning once within the existing deadline;
- preserve unresolved model-declared items exactly rather than coercing them.

Not included:

- background intake;
- manual sorting controls;
- automatic retry after reload;
- Recall changes;
- public-copy changes.

Acceptance:

- pure planner/validator tests pass;
- no lexical or example-specific semantic rule exists;
- no product UI or persistence behavior changes;
- existing accepted routing outputs remain unchanged except the named planned-routing capability.

## Sprint P2 — Atomic settlement and partial unresolved remainder

Product outcome: a validated plan settles exactly once; only unresolved portions remain Unsorted.

Scope:

- apply the full validated plan atomically;
- settle understood Actions, Threads, Intentions, dates, and relationships exactly once;
- keep unresolved source spans under the same `captureId` with exact provenance and attachments;
- prevent existing/new Thread duplicates and duplicate Actions mechanically from explicit plan identities and current board state, without inferring meaning;
- preserve image ownership and Record history.

Acceptance:

- a multi-part capture can settle understood items while preserving only the unresolved remainder;
- failure before commit changes no classified board state;
- retry/reload creates no duplicate settlement;
- raw source concatenation remains lossless;
- local and Cloud integration tests produce equivalent semantic outcomes.

## Sprint P3 — Durable intake before AI

Product outcome: pressing Capture saves immediately and never leaves the app blocked behind inference.

Scope:

- persist the raw text, transcript, attachments, timestamp, destination context, and `captureId` locally before requesting AI;
- show it in Unsorted immediately;
- start one bounded sorting attempt in the background;
- keep navigation, composer, existing captures, and Settings usable while sorting;
- clear the composer and acknowledge saving only after durable local persistence succeeds;
- map offline, timeout, provider, and malformed-output failures to the stable pending state without exposing internals.

Acceptance:

- forced storage failure leaves text and attachments in the composer and shows no false saved receipt;
- offline/provider/malformed failures preserve one exact pending capture;
- no endless spinner or app-wide busy state;
- reload during inference retains the capture;
- late model success can settle only the still-pending item.

## Sprint P4 — One- or two-click manual sorting

Status: **common path stabilization complete in the isolated branch.** Action,
Intention, existing/new Thread, Later, durable authority, truthful receipts,
Undo-learning boundaries, and temporary-Thread semantic exclusion are covered
by focused regressions. This is not full P4 completion.

Product outcome: common pending captures can be filed without waiting for AI.

Controls beneath an Unsorted capture:

- **Action** — one click, original wording, default shelf life;
- **Intention** — one click, original wording, no generated actions or counter-intentions;
- **Thread** — opens a compact picker; second click chooses an existing Thread or creates a new one;
- **Later** — hides the controls while leaving the item safely Unsorted;
- **Split manually** — a separate secondary editor. Segmentation is entirely
  user-authored and mechanically lossless; each segment receives an explicit
  destination. Attachments remain exactly once on the original pending
  envelope rather than being guessed, duplicated, or dropped.

For offline new-Thread creation, use a clearly temporary title derived mechanically from the opening words and allow later rename. Do not treat that title as a learned semantic boundary.

Acceptance:

- common manual filing takes no more than two clicks;
- the explicit user choice is authoritative;
- manual settlement atomically changes the capture from pending to manually sorted;
- any delayed model result is canceled or ignored;
- manual filing creates no duplicate result;
- a correction example may be recorded only as bounded full semantic context, never as a word mapping;
- cancellation, stale destination, images, offline state, and edit/delete races are covered.

## Sprint P5 — Pending recovery, retry, images, and sync

Status: **internally source-verified on the isolated P1–P5 tree; ready for
independent read-only review, not owner testing.**

Product outcome: Unsorted remains a reliable safety layer across sessions and devices.

Scope:

- restore pending captures and images after reload/browser restart;
- preserve pending state through Cloud sync once the original local write syncs;
- allow explicit **Sort now** retry when online;
- optionally schedule quiet bounded retries only if they cannot surprise the user, block work, or overwrite a manual result;
- make retries idempotent by `captureId` and current status;
- preserve exact attachments through failed and successful retries.

Bounded orchestration policy:

- the durable retry record is local recovery metadata, names the exact pending
  ledger row, capture, target, revision, source, input source, and ordered image
  ids, and is written in the same intake transaction as the Board and image
  bytes;
- automatic work is limited to two provider attempts per exact pending
  revision: the ordinary post-save attempt plus at most one quiet recovery
  attempt after a 30-second backoff;
- startup and an offline-to-online transition take one finite snapshot of due
  work, oldest first, process at most three envelopes serially, and do not poll,
  recurse, or install an always-on queue; another automatic pass requires a new
  startup/online transition;
- a durable claim is recorded before provider work, so close/reload/timeout
  consumes that attempt instead of restarting an endless loop;
- local recovery metadata does not authorize another device to retry
  automatically. Synced pending captures remain explicitly sortable there;
- **Sort now** is independent of the automatic-attempt ceiling, but each click
  remains a single 55-second, per-card attempt. It never sets app-wide busy;
- every attempt loads every referenced image byte in declared order before the
  request. Missing bytes leave the envelope unchanged and consume no semantic
  settlement; image-bearing requests use the existing image-aware route only;
- finalization revalidates the exact pending snapshot inside the shared durable
  Board lane. A changed, deleted, manually settled, already settled, or synced
  envelope makes the response stale and writes no classified output;
- successful/manual/deleted/stale envelopes retire their local recovery record;
  provider, timeout, malformed-output, missing-image, or persistence failure
  leaves the exact pending envelope and stable failure behavior intact.

Acceptance:

- several pending captures survive reload in order;
- offline image plus text survives reload with the attachment intact;
- retry settles one result without duplication;
- another device can receive the pending item after sync without cross-account exposure;
- a manual result on either device defeats a delayed automatic result;
- failed retry leaves the pending envelope untouched.
- scenarios 13–18 are deterministic acceptance tests in P5 (P6 retains the
  later real-provider/rendered qualification): fully offline capture; timeout
  after durable save; reload with several ordered pending captures; manual sort
  before a delayed response; offline image then reload; retry without duplicate
  output;
- cross-device tests cover pending/image transfer, manual-on-either-device
  defeating a delayed response after sync, no stale pending resurrection, and
  malformed provider output remaining pending;
- navigation, composer, Settings, and unrelated cards remain usable throughout.

## Sprint P6 — Integrated 18-exercise qualification

Product outcome: prove planned routing and the safety layer together on an accumulated board.

Run the fixed sequence automatically against one populated synthetic board, then on one identified Preview. Fix exact expectations before execution.

Routing cases:

1. One capture routed to two existing Threads.
2. One capture routed to three existing Threads.
3. Existing Thread plus a genuinely new Thread.
4. Multiple Threads plus extracted Actions.
5. TechTutor plus Retake regression.
6. Capture plus Ovid plus rest-day regression.
7. Paraphrased duplicate-Thread prevention.
8. Paraphrased duplicate-Action prevention.
9. Today, tomorrow, and next-Friday deadlines.
10. Manual correction followed by unseen semantic paraphrases.
11. Unrelated captures sharing correction words.
12. Malformed provider response and safe Unsorted fallback.

Safety-layer cases:

13. Capture while completely offline.
14. Provider timeout after the thought is durably saved.
15. Reload with several pending Unsorted captures.
16. Manually sort before a delayed model response arrives.
17. Attach an image while offline, then reload.
18. Retry sorting without creating duplicate items.

Release bar:

- every original thought and attachment survives;
- zero missing or extra destinations;
- zero unnecessary or duplicate Threads;
- zero duplicate Actions or settlements;
- all explicit deadlines stored correctly;
- zero phrase-rule redirects or invented semantic content;
- ambiguous or invalid portions remain exact in Unsorted;
- common manual sorting takes at most two clicks;
- delayed AI never overrides the user;
- local and Cloud paths both pass persistence, reload, sync, privacy, and rendered QA;
- the same accumulated sequence passes three complete rounds on the intended primary model and one complete forced-fallback round;
- Gleb approves the exact identified Preview after automated and independent rendered verification.

## Sprint discipline

- One sprint, one narrow product outcome, one exact build, one bounded owner checklist.
- Internally prove a sprint before asking Gleb to test it.
- Freeze the worktree while an owner-test build is active.
- Preserve every accepted sprint as a release-blocking regression.
- Reject and repair the current boundary instead of opening unrelated work.
- Do not merge until P1–P6 are accepted; the protected local and Cloud deployments remain unchanged throughout.
