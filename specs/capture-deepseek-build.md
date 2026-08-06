# Capture agent — DeepSeek build brief (phased, grounded)

Status: implementation-ready.
Date: 2026-08-06.
Owner: Gleb.
Audience: the model executing the build (DeepSeek, or any agent working the Capture repo).

Read this whole file before writing code. It supersedes the earlier `specs/capture-personal-agent-brief.md` where they differ. The earlier brief had good intent but was partly behind the code. This one is corrected against what actually exists.

---

## 0. How to use this doc

- This is the build instruction. The repo is the source of truth; read the files cited before editing them.
- Build phases in order. Each phase is independently shippable and verifiable.
- Do not rebuild things that already exist (section 1). The biggest trap is a parallel proposal system next to the working one.
- Hard constraints are in section 6. They are non-negotiable.
- Verify every phase with: `npm run lint` && `npm run test` && `npx tsc --noEmit`. Do NOT run `npm run build` if `npm run dev` is live on port 3000.

---

## 1. What already exists (do NOT rebuild)

These are built. Reuse them; do not write competitors.

- **`src/lib/related.ts`** — deterministic engine: `relatedTo`, `bestThreadHome`, `bestActionDuplicate`, `bestFragmentDuplicate`. This is the phrase-exact proposal source. V1 proposals come from here.
- **`src/hooks/useBoard.ts`** — already has a proposal→approve loop: `computeSuggestion` / `acceptSuggestion`. A quiet post-capture card ("this belongs with X") applies one at a time through existing mutations. That IS "agent suggests, user approves."
- **Git history** — one-tap Related actions (merge, move fragment, extract, fold in) and duplicate flagging already landed.
- **`BACKLOG.md`** — already specifies "Tidy": the on-demand, board-wide review panel reusing the suggestion machinery. Build that, not a new `threadReview.ts`.
- **`src/lib/ledger.ts`** — append-only capture record (`raw → clean → kind/target/model`), union-by-id merge. A recent-context few-shot seed was already added to the sort prompt this session.
- **`src/app/api/{sort,distill,intention}/route.ts`** — the model prompts. Distill enforces a 2-question budget + `[ready]` marker; do not disturb that discipline.
- **`src/lib/providers.ts`** — chain Groq → Mistral → Gemini → OpenRouter. No router. Keys absent = tier skipped.

---

## 2. Language parity (Phase 0 — trivial, safe, do first)

Capture has no language lock, but two spots are English-biased. Fix both.

### 2.1 Proofreader prompt
File: `src/app/api/distill/route.ts`, the `PROOFREADER` constant.
Add one rule (keep existing brand-preservation rule):
```text
The user may write in any language. Fix errors in that language and never translate. Preserve the user's language; never convert it to English.
```
No schema change. No type change.

### 2.2 TTS voice language
File: `src/hooks/useSpeech.ts`, around line 40:
```ts
const en = voices.filter((v) => v.lang.startsWith("en"));
```
Today it hardcodes `en`. Change to pick voice by the detected language of the text being spoken (simple heuristic: detect common lang tokens, or pass the capture language through). Fall back to `en` when no matching voice exists. This is a small change in one function; no data-model change.

### 2.3 Verify
Lint/test/tsc pass. No secrets. No board/ledger/schema impact.

---

## 3. New Assistant mode (design section — distinct from Distill)

Gleb wants to also: ask about the app, get thread cleanup, give tasks. Do NOT fold this into Distill.

### Why not Distill
Distill has one job: clarify a half-formed thought, then file it. Its prompt enforces a strict budget (2 questions, then `[ready]`, then file). Overloading it breaks the budget, the file path, and the credit model.

### Three modes (keep Distill unchanged)
- **Capture** — file a thought, no AI.
- **Distill** — clarify + file. Strict, budgeted. Unchanged.
- **Assistant** — ask about the app, run tasks, review threads. New.

### Assistant shape
- Uses the `CaptureProposal` type from the agent brief (rename_thread, clean_fragment, extract_action, combine_fragments, refresh_summary).
- "Clean my threads" → runs the Tidy scan (Phase 1), returns proposal cards.
- "What did I capture about X?" → reads board, answers. Compressed context only.
- Opt-in only. Capture and Distill stay free/fast.
- Credit controls: deterministic `related.ts` first (free); model only for ambiguous cases. Same as Tidy V1.

### Build priority
Assistant is Phase 4 (deferred until Tidy + ledger land). Design it now; build later.

---

## 4. Claude's grounded assessment (carry as constraints)

The following came from a prior review and is correct. Treat it as required context.

- **V1 is ~60% built.** Finish it by assembling existing `related.ts` + suggestion-card + one-tap-apply into the BACKLOG "Tidy" panel. Mostly wiring, not new architecture.
- **V2 splits in two:**
  - *Correction ledger* (record accept/dismiss/correct): cheap, safe, agent-readable, valuable alone. Build it.
  - *Personal model as few-shot*: powerful but dangerous. A handful of idiosyncratic corrections can bias every future filing, and a bad learned rule is invisible. Must be bounded and inspectable.
- **V3 embeddings: defer.** `related.ts` phrase-matching already approximates "similar thread" for a personal low-volume board. Embeddings add an index to build/maintain/invalidate. Poor cost/benefit until the board is large.
- **Two risks the spec underweighted:**
  1. *Cost collision.* "Inject top corrections into every prompt" fights the app's "many small fast calls" design. "Top" needs a hard cap + ranking or every capture gets slower/pricier.
  2. *Invisible steering.* A learned rule that silently changes filing is a softer version of forbidden auto-mutate. Add a clause: **learned rules must be inspectable and clearable.**
- **Effectiveness is front-loaded.** Tidy + correction ledger deliver most of the "works with me" feel at low risk. Learning is the differentiator but must be bounded.

---

## 5. Phased build plan

### Phase 0 — Language parity (trivial, safe)
Files: `src/app/api/distill/route.ts`, `src/hooks/useSpeech.ts`.
Steps: section 2.1, 2.2.
Verify: lint/test/tsc.
Risk: none.

### Phase 1 — Finish Tidy (V1, use existing machinery)
Do NOT create `threadReview.ts`.
Files: `src/hooks/useBoard.ts`, `src/lib/related.ts`, a new Tidy panel component, `BACKLOG.md` as spec.
Steps:
1. Add an on-demand "Tidy" trigger (button on the board view).
2. On trigger, scan all threads + actions via `related.ts` deterministic functions.
3. Produce suggestion cards: duplicate action, merge threads, move fragment, extract action, refresh summary.
4. Deterministic only (no model calls) for V1.
5. High-confidence only. Show medium behind "show more"; drop low.
6. Apply each through existing `useBoard` mutations (`acceptSuggestion` pattern).
7. Reversible via existing snapshot/undo.
Verify: unit tests for suggestion generation + apply paths; lint/test/tsc; manual board check.
Risk: low. This is wiring, not new architecture.

### Phase 2 — Correction ledger (extend ledger.ts)
Files: `src/lib/ledger.ts`, `src/hooks/useBoard.ts`, `scripts/export-capture.mjs`.
Steps:
1. Add `CorrectionEntry` type:
```ts
type CorrectionEntry = {
  id: string;
  at: number;
  proposalKind: "rename_thread" | "clean_fragment" | "extract_action" | "combine_fragments" | "refresh_summary" | "related_suggestion";
  accepted: boolean;
  context: string;
  correctionText?: string;
  rule?: string;
};
```
2. Append on every accept/dismiss/correct in `useBoard`.
3. Union-by-id merge like `mergeLedgers` (append-only, no conflicts).
4. Export to `CaptureVault/` as `corrections.json` for agent readability.
No UI needed to start recording. Value even before any learning.
Verify: lint/test/tsc; export produces valid `corrections.json`.
Risk: low.

### Phase 3 — Bounded personal model (visible, clearable)
Files: `src/app/api/sort/route.ts` (few-shot injection), a small `learnedRules` store, a settings view.
Steps:
1. Build on the recent-context few-shot already in the sort prompt.
2. Weight suggestions by `CorrectionEntry` (accept = +, dismiss = -).
3. Hard cap: inject at most top 5 rules. Rank by recency + confidence.
4. Surface a "What Capture has learned about how you file" list. Each rule editable and clearable.
5. Advisory only: changes the *proposal*, never the board.
Verify: lint/test/tsc; clearing a rule removes it from next prompt; no board mutation from rules.
Risk: medium. Bounded by cap + visibility.

### Phase 4 (deferred) — Assistant mode
Design in section 3. Build only after Phase 1-3 land and Gleb confirms.
Risk: medium (credit cost, surface design).

### Deferred — V3 embeddings
Revisit only when phrase-matching visibly fails on a large board.

---

## 6. Hard constraints (do not violate)

- No auto-tidy / one-click rewrite / auto-delete.
- No general chat-with-notes.
- No plugin system / graph / wiki links.
- No model router. Provider chain stays Groq → Mistral → Gemini → OpenRouter.
- No two-way Markdown editing until conflict model is proven.
- Raw fragments preserved. Consolidation changes the lens, not the history.
- Every structural write requires proposal-card approval.
- Learning informs; never auto-mutates.
- Learned rules must be inspectable and clearable.
- Few-shot injection hard-capped; never tax the "small fast call" path.
- Do not create a parallel proposal system next to `useBoard`'s existing one.

---

## 7. For the executing agent

- Read section 1 files first.
- Do Phase 0, then 1, 2, 3. Report what you built, deferred, and verified.
- Reuse `related.ts` and `useBoard` suggestion machinery. Do not duplicate.
- Apply through existing mutations. The model never writes board state directly.
- If unsure, propose; do not assume.
- Commit only after lint/test/tsc pass. No secrets in diff.

## 8. Reference files (read before editing)

- `src/lib/related.ts` — deterministic proposal source.
- `src/hooks/useBoard.ts` — suggestion loop + mutations.
- `src/lib/ledger.ts` — append-only record; extend here for corrections.
- `src/app/api/sort/route.ts` — sort prompt; few-shot injection point.
- `src/app/api/distill/route.ts` — Distill + PROOFREADER (language fix here).
- `src/app/api/intention/route.ts` — intention engine.
- `src/lib/providers.ts` — model chain.
- `src/hooks/useSpeech.ts` — TTS language fix here.
- `scripts/export-capture.mjs` — export; add `corrections.json`.
- `BACKLOG.md` — Tidy spec.
- `specs/capture-personal-agent-brief.md` — earlier brief (context; this doc supersedes it).
- `research/capture-limited-agent-repo-patterns.md` — repo research.
- `specs/capture-agent-architecture-radar.md` — architecture radar.
