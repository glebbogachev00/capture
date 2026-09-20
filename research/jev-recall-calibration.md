# Jev Recall/Search shadow calibration

_Status: foundation only. Disabled by default. No live calls or private data were used._

## Runtime boundary

`CAPTURE_JEV_RECALL_SHADOW=1` is independent of the thread-rerank and judge
flags. When it is absent (the default), the adapter does not schedule work or
call OpenRouter. When explicitly enabled with `OPENROUTER_API_KEY`, the cited
Recall route first finishes authentication, request validation, prose
inference, citation validation, and identity-expiry checks. It then registers a
single Decisions request through Next's post-response `after()` primitive.

The existing Recall result remains authoritative. Jev cannot reorder sources,
skip the prose call, change `answered`/`insufficient`, write claims, produce
citations, or alter the response. Missing or malformed answers, timeouts,
privacy-routing refusal, and scheduler failure are caught and discarded.

## Payload and logs

The shared server-only transport fixes the endpoint, five-second timeout,
one-request/no-retry behavior, and non-overridable
`allow_fallbacks:false` / `data_collection:"deny"` / `zdr:true` policy.
The feature adapter sends only:

- the trimmed question, capped at 500 characters;
- at most 12 excerpts, each capped at 1,000 characters;
- opaque `source_N` labels plus the required `none` choice;
- one Choice question for intent, one Choice question for source ranking, and
  one Noul question for evidence sufficiency in the same request.

Only structured fields are omitted: original source/target/fragment IDs, source
titles, kinds, timestamps/dates, lifecycle states, navigation targets,
account/session identifier fields, authoritative answer prose, and citations.
This is not value-level redaction. The bounded question and excerpts are **not
redacted**; after trimming and clipping, they are sent as the person wrote them.
They may contain identifier-, title-, date-, state-, navigation-, account-, or
session-like values written as prose. The adapter does not detect or remove
those values.

Success logs contain only counts, intent class, opaque source index/rank,
probability buckets, authoritative status, token count, and comparison flags.
Failure logs use the shared sanitized error shape. Neither path logs content,
IDs, answer prose, citations, keys, provider bodies, or provider output.

## Synthetic harness

- Fixtures: `src/lib/fixtures/jevRecallSynthetic.json`
- Harness: `src/lib/jevRecallBenchmark.ts`
- Tests: `src/lib/jevRecallBenchmark.test.ts`

The harness measures exact intent agreement, pairwise source-rank agreement,
evidence-sufficiency agreement, potential avoided prose calls, and unsafe
suppressions. It exposes every numerator and denominator as counts:

- agreement rates use `intentAgreementCount`, `sourceRankAgreementCount`, or
  `sufficiencyAgreementCount` over `caseCount` or `sourcePairCount`;
- `potentialAvoidedProseCallRate` is `potentialAvoidedProseCallCount /
  caseCount`;
- `unsafeShareOfSuppressedCalls` is `unsafeSuppressionCount /
  potentialAvoidedProseCallCount`;
- `falseNegativeRate` is `unsafeSuppressionCount /
  expectedProseCallCount`.

Every rate is `0` when its denominator is `0`; no `NaN` or infinity is emitted.
The harness accepts already-interpreted observations and deliberately defines
no probability threshold. Nothing in production imports it. Synthetic results
are non-promotional: they prove only the harness behavior and cannot justify a
threshold, routing change, source reorder, or prose-call suppression.

## Promotion blockers

Do not activate routing, source reordering, or prose-call suppression until all
of these are resolved:

1. Confirm the exact OpenRouter key is excluded from Input & Output Logging and
   input/output-use sharing is disabled.
2. Verify with a harmless non-sensitive request that the exact Decisions
   endpoint/model accepts `data_collection:"deny"` and `zdr:true` with fallback
   disabled.
3. Approve OpenRouter/TypeSafe as an additional recipient for bounded Recall
   questions and excerpts, and approve the disclosure for that extra processor.
4. Collect enough approved, representative labeled observations to evaluate
   intent, ranking, sufficiency, and abstention beyond synthetic fixtures.
5. Set explicit acceptable bounds for `unsafeShareOfSuppressedCalls` and
   `falseNegativeRate`, then calibrate any threshold. This change selects no
   threshold.
6. Re-evaluate alpha API/model compatibility, retention terms, ZDR eligibility,
   latency, and cost before promotion.

Until those conditions are met, `potentialAvoidedProseCallByIntent` is only a
shadow calibration field. No call is avoided and no user-visible behavior is
changed.
