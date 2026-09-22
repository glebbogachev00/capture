# Release-candidate integration manifest

## Scope

- Target: `/Users/glebbogachev/Documents/Capture-launch-candidate` on `release/capture-launch-candidate`
- Base: `a1f36862b3a0ec0a911754bb02d193e43f7dcf85` (`origin/main` at integration start)
- Source lanes were read only. No merge, rebase, cherry-pick, commit, stash, reset, clean, push, deployment, live provider call, environment-file read, secret read, or service mutation was performed.
- Inventory: **11 launch-closeout entries + 38 OpenRouter/Jev entries + 8 Search entries = 57 source entries / 54 unique paths**. Three paths overlap between launch-closeout and OpenRouter: `package.json`, `package-lock.json`, and `src/app/api/sort/route.ts`.
- Public landing/marketing source is unchanged. Setup, data-flow, research, acceptance, and closeout documentation are included because they are part of the source lanes.

## Overlap decisions

1. `package.json`: keep the closeout one-worker canonical check and hosted source gate; add OpenRouter setup and `server-only`.
2. `package-lock.json`: use the closeout's complete in-range transitive lock update, then add the exact OpenRouter `server-only@0.0.1` root and package records.
3. `src/app/api/sort/route.ts`: keep the uncapped explicit-task prompts and add the disabled-by-default post-response Jev thread shadow. The normal response and existing unsorted failure catch path remain authoritative.
4. Search/Recall: keep the final automatic question detector, immediate local results, disclosure-before-transmission, bounded source fingerprinting, one-attempt-per-query-visit behavior, stale-request aborts, citation validation, and no-persistence behavior. The Jev Recall shadow remains a separate post-response observation behind an exact-`1` flag.
5. Documentation: reconcile only statements made stale by combining independently developed lanes. No public marketing page or product copy was changed.

## Source-file disposition

| Lane | Source branch | Source state | Source changed file | Target disposition |
|---|---|---|---|---|
| `launch-closeout` | `release/capture-launch-closeout` | modified | `package-lock.json` | Reconciled overlap: retained all closeout transitive lock updates; added exact `server-only@0.0.1` root/module entries. |
| `launch-closeout` | `release/capture-launch-closeout` | modified | `package.json` | Reconciled overlap: retained serialized `check` and `check:launch-hosted`; added `setup:openrouter` and `server-only` from OpenRouter lane. |
| `launch-closeout` | `release/capture-launch-closeout` | modified | `src/app/api/distill/route.ts` | Applied exactly from source tracked diff. |
| `launch-closeout` | `release/capture-launch-closeout` | modified | `src/app/api/sort/route.ts` | Reconciled overlap: retained uncapped explicit-task prompt changes plus post-response Jev thread shadow scheduling. |
| `launch-closeout` | `release/capture-launch-closeout` | modified | `src/components/CloudBilling.test.tsx` | Applied exactly from source tracked diff. |
| `launch-closeout` | `release/capture-launch-closeout` | modified | `src/lib/fragOps.ts` | Applied exactly from source tracked diff. |
| `launch-closeout` | `release/capture-launch-closeout` | untracked | `docs/launch-closeout-2026-09-19.md` | Copied, then reconciled only stale lane-isolation/Search/OpenRouter statements to describe the combined release candidate. |
| `launch-closeout` | `release/capture-launch-closeout` | untracked | `scripts/launch-hosted-source-gate.sh` | Copied exactly from source untracked file. |
| `launch-closeout` | `release/capture-launch-closeout` | untracked | `src/components/ExplicitTasks.test.tsx` | Copied exactly from source untracked file. |
| `launch-closeout` | `release/capture-launch-closeout` | untracked | `src/lib/explicitTasks.fixture.ts` | Copied exactly from source untracked file. |
| `launch-closeout` | `release/capture-launch-closeout` | untracked | `src/lib/explicitTasksPrompt.test.ts` | Copied exactly from source untracked file. |
| `openrouter-launch` | `feat/openrouter-launch-setup` | modified | `.env.example` | Applied exactly from source tracked diff. |
| `openrouter-launch` | `feat/openrouter-launch-setup` | modified | `README.md` | Applied exactly from source tracked diff. |
| `openrouter-launch` | `feat/openrouter-launch-setup` | modified | `SETUP.md` | Applied exactly from source tracked diff. |
| `openrouter-launch` | `feat/openrouter-launch-setup` | modified | `docs/DATA-FLOW.md` | Applied, then reconciled Recall timing to the final 600 ms automatic-question flow and disclosure-before-transmission boundary. |
| `openrouter-launch` | `feat/openrouter-launch-setup` | modified | `package-lock.json` | Reconciled overlap: retained exact `server-only@0.0.1` entries on top of the closeout lock update. |
| `openrouter-launch` | `feat/openrouter-launch-setup` | modified | `package.json` | Reconciled overlap: retained OpenRouter script/dependency and launch-closeout serialized/hosted checks. |
| `openrouter-launch` | `feat/openrouter-launch-setup` | modified | `scripts/setupEnv.mjs` | Applied exactly from source tracked diff. |
| `openrouter-launch` | `feat/openrouter-launch-setup` | modified | `src/app/api/judge/route.ts` | Applied exactly from source tracked diff. |
| `openrouter-launch` | `feat/openrouter-launch-setup` | modified | `src/app/api/recall/route.ts` | Applied exactly from source tracked diff. |
| `openrouter-launch` | `feat/openrouter-launch-setup` | modified | `src/app/api/sort/route.ts` | Reconciled overlap: retained Jev shadow import/scheduling plus closeout explicit-task prompt changes; existing catch path remains unchanged. |
| `openrouter-launch` | `feat/openrouter-launch-setup` | modified | `src/lib/providers.test.ts` | Applied exactly from source tracked diff. |
| `openrouter-launch` | `feat/openrouter-launch-setup` | modified | `src/lib/providers.ts` | Applied exactly from source tracked diff. |
| `openrouter-launch` | `feat/openrouter-launch-setup` | modified | `src/lib/providersRetry.test.ts` | Applied exactly from source tracked diff. |
| `openrouter-launch` | `feat/openrouter-launch-setup` | modified | `src/lib/recallRoute.test.ts` | Applied exactly from source tracked diff. |
| `openrouter-launch` | `feat/openrouter-launch-setup` | modified | `src/lib/setupEnv.test.ts` | Applied exactly from source tracked diff. |
| `openrouter-launch` | `feat/openrouter-launch-setup` | modified | `src/lib/sortThreadRoute.test.ts` | Applied exactly from source tracked diff. |
| `openrouter-launch` | `feat/openrouter-launch-setup` | modified | `vitest.config.mts` | Applied exactly from source tracked diff. |
| `openrouter-launch` | `feat/openrouter-launch-setup` | untracked | `research/jev-judge-calibration.md` | Copied exactly from source untracked file. |
| `openrouter-launch` | `feat/openrouter-launch-setup` | untracked | `research/jev-openrouter-integration.md` | Copied exactly from source untracked file. |
| `openrouter-launch` | `feat/openrouter-launch-setup` | untracked | `research/jev-recall-calibration.md` | Copied exactly from source untracked file. |
| `openrouter-launch` | `feat/openrouter-launch-setup` | untracked | `research/jev-search-that-answers-design.md` | Copied, then reconciled the pre-integration click-based description to the final automatic question detector/debounce/disclosure flow. |
| `openrouter-launch` | `feat/openrouter-launch-setup` | untracked | `scripts/setup-openrouter.mjs` | Copied exactly from source untracked file. |
| `openrouter-launch` | `feat/openrouter-launch-setup` | untracked | `src/lib/fixtures/jevJudgeSynthetic.json` | Copied exactly from source untracked file. |
| `openrouter-launch` | `feat/openrouter-launch-setup` | untracked | `src/lib/fixtures/jevRecallSynthetic.json` | Copied exactly from source untracked file. |
| `openrouter-launch` | `feat/openrouter-launch-setup` | untracked | `src/lib/jevJudgeBenchmark.test.ts` | Copied exactly from source untracked file. |
| `openrouter-launch` | `feat/openrouter-launch-setup` | untracked | `src/lib/jevJudgeBenchmark.ts` | Copied exactly from source untracked file. |
| `openrouter-launch` | `feat/openrouter-launch-setup` | untracked | `src/lib/jevJudgeRoute.test.ts` | Copied exactly from source untracked file. |
| `openrouter-launch` | `feat/openrouter-launch-setup` | untracked | `src/lib/jevJudgeShadow.test.ts` | Copied exactly from source untracked file. |
| `openrouter-launch` | `feat/openrouter-launch-setup` | untracked | `src/lib/jevJudgeShadow.ts` | Copied exactly from source untracked file. |
| `openrouter-launch` | `feat/openrouter-launch-setup` | untracked | `src/lib/jevRecallBenchmark.test.ts` | Copied exactly from source untracked file. |
| `openrouter-launch` | `feat/openrouter-launch-setup` | untracked | `src/lib/jevRecallBenchmark.ts` | Copied exactly from source untracked file. |
| `openrouter-launch` | `feat/openrouter-launch-setup` | untracked | `src/lib/jevRecallShadow.test.ts` | Copied exactly from source untracked file. |
| `openrouter-launch` | `feat/openrouter-launch-setup` | untracked | `src/lib/jevRecallShadow.ts` | Copied exactly from source untracked file. |
| `openrouter-launch` | `feat/openrouter-launch-setup` | untracked | `src/lib/jevThreadRerank.test.ts` | Copied exactly from source untracked file. |
| `openrouter-launch` | `feat/openrouter-launch-setup` | untracked | `src/lib/jevThreadRerank.ts` | Copied exactly from source untracked file. |
| `openrouter-launch` | `feat/openrouter-launch-setup` | untracked | `src/lib/openRouterDecisions.server.test.ts` | Copied exactly from source untracked file. |
| `openrouter-launch` | `feat/openrouter-launch-setup` | untracked | `src/lib/openRouterDecisions.server.ts` | Copied exactly from source untracked file. |
| `openrouter-launch` | `feat/openrouter-launch-setup` | untracked | `test/server-only.ts` | Copied exactly from source untracked file. |
| `search-answer` | `feat/capture-search-answer` | modified | `docs/cited-search-acceptance.md` | Applied exactly from source tracked diff. |
| `search-answer` | `feat/capture-search-answer` | modified | `src/app/Capture.tsx` | Applied exactly from source tracked diff. |
| `search-answer` | `feat/capture-search-answer` | modified | `src/components/Capture.recall.test.tsx` | Applied exactly from source tracked diff. |
| `search-answer` | `feat/capture-search-answer` | modified | `src/components/QuestionAnswer.module.css` | Applied exactly from source tracked diff. |
| `search-answer` | `feat/capture-search-answer` | modified | `src/components/QuestionAnswer.test.tsx` | Applied exactly from source tracked diff. |
| `search-answer` | `feat/capture-search-answer` | modified | `src/components/QuestionAnswer.tsx` | Applied exactly from source tracked diff. |
| `search-answer` | `feat/capture-search-answer` | modified | `src/lib/recall.test.ts` | Applied exactly from source tracked diff. |
| `search-answer` | `feat/capture-search-answer` | modified | `src/lib/recall.ts` | Applied exactly from source tracked diff. |

## Completeness accounting

| Lane | Modified | Untracked | Source entries |
|---|---:|---:|---:|
| `launch-closeout` | 6 | 5 | 11 |
| `openrouter-launch` | 17 | 21 | 38 |
| `search-answer` | 8 | 0 | 8 |
| **Total source entries** | **31** | **26** | **57** |

Unique target paths represented by source lanes: **54**. Target-only integration artifact: `docs/integration-manifest-2026-09-20.md`.

## Safety invariants reviewed

- All three Jev runtime gates remain absent/off by default and enable only when the dedicated variable is exactly `1` and `OPENROUTER_API_KEY` exists.
- Thread, judge, and Recall Jev work remains observational, post-authoritative-path, one-request/no-retry, ZDR/no-collection/no-fallback, and fail-open to existing behavior.
- Sort's catch path and the client unsorted settlement path are unchanged; provider failure still preserves the capture locally.
- Ordinary Search stays local and immediate; Recall failure, timeout, invalid citations, offline state, or unavailable ownership never removes local keyword results or mutates saved notes.
- No `.env*` value or secret was read. Only the tracked `.env.example` template was integrated.

## Verification

- Focused overlap run: **18 files / 304 tests passed** (explicit tasks, billing race, provider ordering/setup, Decisions transport, all three Jev shadows/benchmarks/routes, Sort overlap, Recall route/retrieval/UI/Capture integration).
- Canonical serialized `npm run check`: passed.
  - ESLint: passed with zero reported warnings/errors.
  - Vitest: **195 files / 1,882 tests passed** with one worker.
  - TypeScript: passed with `--noEmit --incremental false`.
  - Next.js 16.3.3 isolated `.next-check` production build: compiled, typechecked, and generated **35 static pages**.
  - Trace guard: **45 manifests**, no private paths.
- `npm run check:launch-hosted`: passed **20 files / 245 tests**, disposable billing SQL, blocked-legacy publication SQL, fresh-publication SQL, and all synthetic five-round browser-client positive/negative scenarios.
- Standalone `npm run lint`: passed.
- Standalone `npx tsc --noEmit --incremental false`: passed.
- `git diff --check`: passed after final manifest/docs reconciliation.
- Completeness validation: all **57** source entries are mapped; the target has exactly the **54** unique source paths plus this manifest, for **55** changed paths total.
- Source-worktree status/file inventories were re-read after integration and remained unchanged.

The production build/trace requirement is satisfied by the canonical check's isolated `NEXT_DIST_DIR=.next-check` build; no second production build was necessary.
