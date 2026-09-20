# Jev through OpenRouter: Capture integration decision

_Research began 2026-09-19 from current first-party OpenRouter and TypeSafe documentation. On 2026-09-20, the pinned endpoint was exercised in the isolated Capture Preview sandbox with invented launch-validation text only; no private Capture data was used._

## Decision

Jev **cannot** use Capture's existing `@openrouter/ai-sdk-provider` chat-model path.

Capture currently constructs `openrouter.chat(OPENROUTER_MODEL)` in `src/lib/providers.ts` and passes that `LanguageModel` to AI SDK `generateObject`. OpenRouter's Jev model page explicitly says Jev does not generate text, runs on the Decisions API rather than the OpenAI-compatible chat endpoint, and that chat-completions SDKs do not work with it. The official contract is a separate `state` + typed `questions` request with `choice`, `score`, or `noul` answers.

The smallest safe implementation is therefore a separate Decisions adapter,
not another provider tier in `chain()`. The shared server-only transport now
lives in `src/lib/openRouterDecisions.server.ts`; feature adapters retain only
their state/questions, answer schema, and local mapping.

## Current first-party contract

| Item | Current value |
|---|---|
| OpenRouter endpoint | `POST https://openrouter.ai/api/alpha/decisions` |
| Pinned OpenRouter model slug | `typesafe/jev-1.13` |
| Moving OpenRouter alias | `~typesafe/jev-latest` (currently redirects to Jev 1.13) |
| TypeSafe direct endpoint | `POST https://api.typesafe.ai/v1/systemone` |
| TypeSafe direct pinned model ID | `jev-1.13.0` |
| TypeSafe direct alias | `jev-latest` |
| OpenRouter price | **$0.042 per 1M input tokens; $0 per 1M output tokens** |
| OpenRouter context shown | 32,000 tokens |

Capture pins `typesafe/jev-1.13` for a reproducible shadow comparison rather than using the moving alias.

### Request/response shape

OpenRouter requires:

```json
{
  "model": "typesafe/jev-1.13",
  "state": { "capture": "..." },
  "questions": {
    "destination": {
      "type": "choice",
      "instructions": "...",
      "criteria": {
        "thread_0": "...",
        "new_thread": "None clearly fits"
      }
    }
  }
}
```

A Choice answer returns the selected option, `confidence`, and a complete `probabilities` distribution. TypeSafe's Choice documentation recommends including a `none of the above` option when the fixed list may not cover the input; Capture maps that to `new_thread`. TypeSafe's reranking cookbook separately demonstrates probability-based reranking. Using one Choice here gives Capture both a ranked distribution over the shortlist and an explicit abstention in one request.

## Capture architecture and integration boundary

- `src/hooks/useBoard.ts` builds bounded thread briefs with `threadBriefs()` and sends them to `/api/sort`.
- `src/app/api/sort/route.ts` performs the generative sort, applies learned rules and series overrides, enforces standing decisions, then calls `reconcileSorted()` before returning the result.
- The Jev shadow is scheduled **only after** a successful reconciled `thread`/`both` result. It never runs on the route's failure path, so the existing client behavior that parks failed captures as unsorted remains unchanged.
- The shadow uses Next's stable `after()` API, so it does not delay the sort response.
- Its answer is never returned to the client and never changes `threadId`, `threadName`, the board, ledger, or UI.

## Privacy and fail-safe boundary

The adapter is off unless both conditions are explicit:

```text
CAPTURE_JEV_THREAD_RERANK_SHADOW=1
OPENROUTER_API_KEY=<configured>
```

Data minimization:

- sends only a nonempty, already-isolated `primaryText`; if reconciliation does not provide one, the shadow is skipped rather than substituting `clean` and risking unrelated action text;
- caps that text at 2,000 characters;
- accepts at most 40 candidate briefs, with names capped at 120 characters and descriptions at 700; a larger unranked set is skipped rather than logged as a misleading partial comparison;
- does **not** send images, recent filing history, learned rules, actions, account/user identifiers, trace/session identifiers, or original thread IDs;
- uses opaque `thread_N` option keys and maps them back to IDs locally.

Every request requires:

```json
{
  "provider": {
    "allow_fallbacks": false,
    "data_collection": "deny",
    "zdr": true
  }
}
```

OpenRouter documents `data_collection: "deny"` as allowing only providers that do not collect user data and `zdr: true` as allowing only zero-data-retention endpoints. OpenRouter itself says prompt retention is opt-in, while request metadata is retained. Its separate Input & Output Logging setting can retain full content for at least three months when enabled; this cannot be disabled in the Decisions request, although OpenRouter lets an operator exclude individual API keys in workspace Observability settings. Before anyone enables the shadow for private notes, the key must be excluded from Input & Output Logging and the separate input/output-use discount must be off. TypeSafe says it does not train on customer requests, but its ordinary privacy policy permits retaining personal data as reasonably necessary and its docs describe ZDR as an enterprise feature. The configured Preview key was confirmed by the owner to have logging/data sharing disabled, and harmless sandbox requests proved that the pinned endpoint accepts the locked no-fallback/no-collection/ZDR envelope. This is runtime compatibility evidence, not a guarantee about future provider terms. The adapter remains fail-open: if no eligible endpoint exists later, the shadow request fails and the normal route remains untouched.

Production logs contain only aggregate comparison fields (candidate count, existing/new selection, candidate index, confidence, input-token count, agreement). They never contain capture text, candidate text, thread IDs, API keys, or provider response/error bodies.

## `/api/judge` shadow foundation

The Tidy judge keeps its existing generative route, full candidate batch,
verdicts, user-facing reasons, provider fallback, and client failure behavior.
A separate `CAPTURE_JEV_JUDGE_SHADOW=1` adapter may run only after that result:

- one independent Noul question per candidate in one Decisions request;
- opaque `candidate_N` labels, with kind/source/target/context capped at
  80/400/400/700 characters;
- the same locked no-fallback/no-collection/ZDR transport policy;
- aggregate score histograms/counts only in logs;
- no filtering, ordering, reason generation, or generative-call elimination.

Failures, missing answers, malformed envelopes, timeouts, privacy-routing
refusals, and ambiguous scores therefore all fall open to the complete
original generative path. There is deliberately no production prefilter API.
The synthetic fixtures/harness and exact activation blocker are in
`research/jev-judge-calibration.md`.

## Implementation status and additional Jev uses

Ranked by likely Capture value. Preview observations remain too small to justify routing or threshold changes.

| Rank | Candidate use | Expected benefit | Latency / cost | Risk | Decision |
|---:|---|---|---|---|---|
| 1 | **Search-that-answers decision layer** | High: stable query intent, semantic reranking, evidence abstention, and selective prose-model invocation can improve answer quality while avoiding unnecessary generation | One combined Decisions roundtrip: TypeSafe evaluates mixed Choice/Noul questions in parallel against one state; current Jev output is free and only added question/input tokens are billed | High privacy scope because the question and retrieved private excerpts reach an additional processor; bad gates can hide answerable evidence | **Shadow foundation implemented, off by default.** See `research/jev-search-that-answers-design.md` and `research/jev-recall-calibration.md`; no private-data activation or routing until disclosure, privacy checks, and calibration are approved. |
| 2 | **Post-sort destination verification with selective escalation** | Medium-high if thread shadow evidence shows Jev catches costly misfiles; could ask a stronger generative model only when Jev and the sorter disagree | One cheap Decisions call; extra latency only if escalation occurs | Medium-high: double processing of personal text, thresholds need real evidence, and Jev cannot repair prose/actions itself | **Watch.** Use shadow agreement/correction evidence first. |
| 3 | **Tidy proposal confidence filter** | Medium: may suppress weak move/merge suggestions before the user sees them | Background-friendly and cheap | High privacy scope because Tidy sees a broad board snapshot; false negatives could hide useful proposals | **Defer.** No approved broader data boundary. |
| 4 | **Distill settle or expensive-LLM gating** | Low-medium theoretical savings | Cheap gate before an unavoidable generative call | High product risk: Jev returns decisions, not the settled/polished artifact; a wrong gate can suppress the core output | **Defer**, matching the existing product decision. |

Jev is useful only where Capture needs a narrow semantic branch. It cannot replace the current chat/generative paths that clean dictation, extract actions, invent a new thread name, summarize, proofread, or polish text.

## Isolated Preview evidence (2026-09-20)

All three shadows were exercised against invented, non-sensitive launch-validation text on `capture-playground` Preview. They remained post-response and observational:

- thread rerank agreed with the authoritative sorter for both a new-thread decision (0.90 confidence, five candidates) and a later existing-thread decision (1.00 confidence, six candidates);
- Recall classified a cited answer as `answer_fact`, placed the top cited source first, and reported high intent/evidence buckets without changing the answer or citations;
- judge shadow returned a low score for the unrelated synthetic candidate and a materially higher score for the launch-related synthetic candidate, while the existing generative verdicts remained authoritative;
- the four observed Decisions requests used 3,577 input tokens in total, approximately $0.000150 at the documented $0.042/M price;
- Preview logs contained only the documented aggregate fields, and no application errors were recorded.

This proves endpoint compatibility, containment, and the usefulness of the calibration signals. It does **not** prove a user-visible quality or latency improvement, select a threshold, or authorize production routing.

## Primary sources

- OpenRouter Jev 1.13 model page, endpoint, incompatibility with chat SDKs, model slug, price, context: <https://openrouter.ai/typesafe/jev-1.13>
- OpenRouter Jev latest alias: <https://openrouter.ai/~typesafe/jev-latest>
- OpenRouter Decisions API reference: <https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-questions-and-answers-request>
- OpenRouter TypeScript Decisions SDK reference: <https://openrouter.ai/docs/client-sdks/typescript/sdks/decisions/README>
- OpenRouter Decisions request and provider preferences: <https://openrouter.ai/docs/client-sdks/typescript/models/decisionsrequest> and <https://openrouter.ai/docs/client-sdks/typescript/models/providerpreferences>
- OpenRouter data collection, Input & Output Logging, and ZDR: <https://openrouter.ai/docs/guides/privacy/data-collection>, <https://openrouter.ai/docs/guides/features/input-output-logging>, and <https://openrouter.ai/docs/guides/features/zdr>
- TypeSafe System One and direct API: <https://docs.typesafe.ai/concepts/system-one> and <https://docs.typesafe.ai/api>
- TypeSafe current models/pricing/data handling: <https://docs.typesafe.ai/models>
- TypeSafe Choice and reranking guidance: <https://docs.typesafe.ai/primitives/choice> and <https://docs.typesafe.ai/cookbooks/rerank_typesafe>
- TypeSafe privacy policy: <https://typesafe.ai/legal/privacy-policy>
