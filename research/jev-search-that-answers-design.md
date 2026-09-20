# Jev boundary for Search-that-answers

_As of 2026-09-20. Disabled-by-default shadow foundation implemented from current Capture source plus first-party OpenRouter/TypeSafe docs. No private notes, credentials, or live calls were used._

## Current Capture path

Capture already separates predictable local Search from answer generation:

1. `src/lib/search.ts` performs local substring Search on every keystroke. It has no network, quota, or model dependency.
2. `src/lib/recall.ts#isLikelyRecallQuestion` keeps ordinary searches local. After a likely question is stable for 600 ms, `recallSources` performs bounded lexical retrieval: at most 12 original fragments/actions/intentions, each at most 1,500 characters. Titles and summaries are not quotable evidence.
3. `src/components/QuestionAnswer.tsx` sends the question plus exact bounded source snapshot to `/api/recall` after the debounce while ownership and online readiness remain valid. The interface stays visually quiet while waiting, then shows only the verified answer and connected-item controls. There is no answer button or Enter requirement.
4. `src/app/api/recall/route.ts` invokes the prose model and requires structured claims with exact source IDs and verbatim quotes.
5. `validateRecallAnswer` independently rejects unknown IDs and non-verbatim quotes. That citation boundary must remain authoritative.

Ordinary local Search therefore stays the fail-open baseline. Jev belongs only in the optional answer path.

## Can the four Jev decisions share one request?

**Yes, when they all evaluate the same query and retrieved shortlist.** TypeSafe documents that all questions in one Decisions request see the same `state`, run independently in parallel, can mix Choice/Noul/Score, and add little latency beyond the tokens for extra questions. Its official semantic-find cookbook combines a Choice ranking with a Noul answer-exists check in one request.

The implemented bounded state contains:

```json
{
  "question": "...",
  "sources": {
    "source_0": { "excerpt": "..." }
  }
}
```

The original structured Capture source IDs and metadata remain local. Jev
receives opaque `source_N` labels, but the bounded question and excerpts are
not redacted. They may contain identifier-, title-, date-, state-, navigation-,
account-, or session-like values written as prose.

Recommended questions in that single request:

1. **`query_intent` — Choice**
   - `find_notes`: retrieve/navigate; no prose answer needed.
   - `answer_fact`: a supported factual answer is useful.
   - `synthesize`: compare or summarize several notes.
   - `unclear`: intent is not stable enough to automate.
2. **`best_source` — Choice** over `source_0..source_N` plus `none`.
   - The complete probability distribution provides a reranking.
   - `none` is mandatory because Choice always selects something, even when every candidate is irrelevant.
3. **`evidence_sufficient` — Noul**
   - High means the submitted source texts directly support a complete answer to the query.
   - Low means they are irrelevant, incomplete, or only partially address it.

### Expensive-answer routing

Do **not** make a fourth model judgment depend on the first three inside the same request: TypeSafe states that same-request questions are independent, so one answer is not context for another. Keep workflow control in deterministic code:

```text
invoke prose answer model =
  intent is answer_fact or synthesize
  AND evidence_sufficient clears an evaluated threshold
```

A speculative `should_invoke_answer_model` Noul could be included in the same request for shadow comparison, but production routing should use the atomic answers above. It is redundant, harder to calibrate, and obscures why the model was invoked.

If later retrieval itself depends on `query_intent`, that creates a real dependency and requires two stages: classify intent, retrieve, then rerank/check sufficiency. Capture's current flow already retrieves a bounded shortlist before any model call, so the first shadow does not need that second roundtrip.

## Implemented shadow-mode foundation

The foundation below is implemented but disabled by default. It must remain
shadow-only until the privacy and calibration gates below are explicitly
resolved:

1. `src/lib/jevRecallShadow.ts` reuses
   `src/lib/openRouterDecisions.server.ts` for strict envelope parsing,
   ZDR/no-collection/no-fallback provider policy, one no-retry timeout, and
   safe errors while retaining its own payload, answer schema, mapping, and
   aggregate logging.
2. `/api/recall` schedules it only after authentication, bounded-body
   validation, authoritative prose inference, citation validation, and final
   identity-expiry checks.
3. One combined Decisions request is registered with `after()`. Source order,
   source inclusion, prose-model invocation, answer content, citations, status,
   and UI remain unchanged.
4. Logs contain only non-content measurements: intent class, opaque best-source
   index/`none`, sufficiency probability bucket, authoritative answer status,
   source/citation counts, token count, and rank-overlap fields.
5. Synthetic fixtures test request shape, multiple-question parsing, `none`
   abstention, malformed distributions, disabled/no-network behavior, provider
   failure, sanitized logs, and calibration metrics.

Synthetic results are non-promotional. They validate the harness and failure
boundaries only; they cannot support a production threshold, source reorder, or
prose-call gate.

Only after fixture tests plus approved real shadow evidence should a later change consider reordering sources or skipping the prose model. Even then:

- Jev failure, timeout, malformed output, unavailable ZDR routing, or low confidence must **fall open to the current Recall path**.
- A Jev `none`/insufficient decision may skip prose only after thresholds are calibrated against real corrections and false-negative cost is accepted.
- Citation generation remains the prose model's job, and `validateRecallAnswer` remains the final structural verifier.
- Local `search()` remains untouched and available when every model path is disabled or dead.

## Privacy boundary / blocker

This design requires sending the question and retrieved source text to an additional OpenRouter/TypeSafe Decisions endpoint. Existing approval for the configured answer provider does not automatically approve an additional processor or a second model call. Only structured metadata fields are omitted. The bounded question and excerpts are not redacted and can carry identifier/title/date/state/navigation/account/session-like values written as prose.

Before enabling the runtime gate with any private data:

- approve TypeSafe/OpenRouter as an additional recipient for bounded Recall sources;
- verify the specific Jev endpoint accepts `provider.zdr: true` and `data_collection: "deny"` without a live private payload;
- exclude the Jev API key from OpenRouter Input & Output Logging and keep the input/output-use discount off;
- approve and document the additional data recipient before activation; the minimal answer surface is not a per-query disclosure.

Until then, the implemented third lane must remain disabled and observational only.

## Expected value, latency/cost, and risk

| Decision | Expected benefit | Latency / cost | Risk |
|---|---|---|---|
| Query intent | Medium: avoids prose for navigation-only requests and gives a stable route | Included in the same Decisions roundtrip; a small number of question tokens | Medium: wrong intent can suppress a useful answer if made active too early |
| Candidate reranking | High: the current shortlist is lexical, so semantic ordering can improve which evidence the prose model reads first | Same request; Choice probability output is free under current Jev pricing | Medium: relative Choice scores always produce a winner, hence mandatory `none`/sufficiency check |
| Evidence sufficiency / abstention | High: can prevent unsupported prose and unnecessary answer calls | Same request; one Noul question | High if thresholded without real calibration; false negatives hide answerable evidence |
| Prose-model gate | Potentially high cost/latency saving after calibration | No extra request when derived in code from intent + sufficiency | Highest product risk; remain shadow-only until measured |

Current Jev pricing remains $0.042 per 1M input tokens and $0 per 1M output tokens. The relevant operational cost is therefore the bounded query/source state sent once plus the extra question text; batching avoids repeating that state across separate requests.

## Primary sources

- TypeSafe primitives and parallel-question contract: <https://docs.typesafe.ai/primitives>
- TypeSafe speculative fan-out: <https://docs.typesafe.ai/patterns/fan-out>
- TypeSafe intent routing: <https://docs.typesafe.ai/patterns/intent-routing>
- TypeSafe semantic-find cookbook (Choice ranking + Noul existence in one request): <https://docs.typesafe.ai/cookbooks/semantic_find>
- TypeSafe Noul: <https://docs.typesafe.ai/primitives/noul>
- OpenRouter Jev model/price/Decisions endpoint: <https://openrouter.ai/typesafe/jev-1.13>
