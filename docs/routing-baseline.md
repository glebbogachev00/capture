# P1 sequential planned-routing gate

`npm run baseline:routing` exercises the opt-in planned-routing seam through `/api/sort`. It uses 12 fixed exercises and a 31-Thread, clearly synthetic accumulated board in `scripts/routing-baseline-cases.json`. Eleven exercises call the target sequentially; the malformed-provider exercise is fixture-only and remains an explicit `SOURCE_FIXTURE_REQUIRED` failure in live artifacts. Every successful live response is applied only to that in-memory board before the next request. The harness imports the production `threadBriefs()` implementation, including its shared total budget and per-Thread bounds, instead of maintaining a second request-context algorithm. Every evaluation request carries a synthetic `captureId`, all current synthetic open Actions, and any bounded correction examples. The harness never reads `.env*`, cookies, credentials, IndexedDB, or `/api/cloud/board`, and it never writes Capture data.

The owner-accepted R1 recovery matrix remains separately fixed in
`scripts/routing-recovery-cases.json`. It preserves all 11 accepted cases,
including single existing reuse, the unrelated-name trap, short and long
captures, a clear Intention, repeated paraphrases, and accumulated-board
coverage. Run it with `--recovery`; that switch deliberately omits the planned
request fields and exercises the legacy recovery route rather than replacing
the planned pack.

## Planned semantic adjudication seams

After structural plan validation, one dedicated destination/subject-boundary
call receives every resolved developing-thought item (stable item id, exact
immutable source, and proposed destinations), every available existing Thread
brief, and fixed metadata for any already-declared new Threads. It must return
one exact decision per item: either one indivisible source part with every
genuine destination, or an ordered exact-source partition whose parts each name
only their genuine destinations. Deterministic code checks exact id coverage,
known destinations, unique decisions, exact source concatenation, and unchanged
non-boundary fields. It derives stable ids mechanically for additional parts,
applies only the declared source boundaries and destinations, and validates the
complete plan again. It never infers a split or route from words or punctuation.

Missing, duplicate, unknown, overlapping, source-mutating, or otherwise
malformed ownership output rejects the complete planned response. The same is
true for provider failure or timeout. Existing Action/deadline ownership,
Intention items, unresolved material, provenance, and new-Thread metadata remain
untouched; an indivisible thought may retain several model-declared destinations.

The routing planner partitions source, owns Action extraction, destinations,
and deadlines, but it must return `duplicateActionId: null`. After that plan
passes structural validation, one dedicated model call receives only the
proposed Actions (stable item id, Action wording, exact owned source, structured
deadline) and all supplied open Actions (id and wording). It returns one strict
decision per proposed Action. An `existing` decision must name the matching open
Action, declare `same_outcome`, and give one bounded outcome rationale. A `new`
decision must name the closest supplied open Action, declare
`distinct_outcome`, and give one bounded rationale for the remaining outcome or
finish-line difference. Deterministic code checks exact proposed-id coverage,
known existing ids, the discriminated decision shape, and immutable plan bytes;
it applies only `duplicateActionId`, then validates the complete unchanged plan
again before compile. There is no text similarity, phrase list, or deterministic
semantic fallback.

Malformed output, missing/duplicate proposed ids, null or unknown comparison ids,
provider failure, or timeout rejects the complete planned response. The client
therefore retains the durable pending capture; the route never treats a failed
identity judgment as `new` and never silently creates an Action.

The complete planned path has at most five logical model calls: one recovery
sort, up to two planner attempts, at most one destination/subject-boundary
adjudication, and at most one Action-identity adjudication. The destination call
is skipped when there is no resolved developing thought; the identity call is
skipped when there are no proposed Actions or no existing open Actions. Every
`generateObject` uses `maxRetries: 0`. Each logical call uses the existing
fallback chain (at most six configured tiers and at most one rate-limit second
round), so the absolute configured maximum is 60 provider attempts. All calls
and fallback waits share one abort signal created at route entry and expire at
55 seconds, five seconds inside Vercel's 60-second limit.

## Run later against localhost

Start the intended candidate build separately, then run:

```sh
npm run baseline:routing -- --out outputs/routing-baseline/planned-local.json
```

Run the mandatory recovery matrix against the same isolated target separately:

```sh
npm run baseline:routing -- --recovery --out outputs/routing-baseline/r1-recovery-local.json
```

The default target is `http://localhost:3000`. An alternate loopback origin must be explicit:

```sh
npm run baseline:routing -- --local http://127.0.0.1:4998 --out outputs/routing-baseline/planned-local-4998.json
```

These commands spend live provider quota. They were not run during source stabilization.

## Run later against an isolated Preview

Remote use is opt-in and accepts only an HTTPS immutable Vercel Preview deployment URL (not a custom domain or ordinary production alias):

```sh
npm run baseline:routing -- --remote https://capture-cfrm3i0d9-glebbogachev00s-projects.vercel.app --out outputs/routing-baseline/recovery-preview-r1-integrity.json
```

The Preview must already expose `/api/sort` without credentials and must be configured as an isolated local-mode/dead-hub deployment. The harness does not authenticate, read secrets, or access a Cloud board.

## Artifact and regression check

The schema-v3 JSON artifact contains only fixed synthetic material: raw case inputs; the complete bounded Thread/Action/correction context sent for each request; observed destination shares; final Actions and structured deadlines; and categorical measurements (exact destination sets, kind, action count, latency, provider `via`, HTTP status, pass/fail, and reason codes). Every existing or new destination share must satisfy its fixed per-case subject expectation; negated subjects and named unrelated subjects do not count. New Threads must also satisfy the fixed name expectation. Required/forbidden Thread IDs, expected new Threads, Action meaning, relative deadline structure, and forbidden duplicates are checked. Extra, missing, duplicate, unknown, swapped, or semantically wrong destinations fail. Unbounded provider prose, raw provider diagnostics, and error bodies are excluded. Output files are created with owner-only permissions under the ignored `outputs/` directory by default.

After an owner accepts an artifact, compare a later run with it:

```sh
npm run baseline:routing -- --compare outputs/routing-baseline/planned-local.json --out outputs/routing-baseline/candidate-local.json
```

A failed oracle case or a changed result for a previously passing case exits nonzero. Transport/setup aborts exit with status 2.

Source and fixture gates (no provider calls):

```sh
npm test -- --maxWorkers=1 src/lib/plannedRouting.test.ts src/lib/plannedRoutingRoute.test.ts src/hooks/useBoard.voiceSource.test.ts && npm run test:routing-baseline
```

A later live artifact is qualified only when the 11-case recovery artifact and
the eleven planned network exercises pass and the source command above is
green. Do not relabel the fixture-only twelfth planned exercise as a live
provider pass.
