# Capture personal-agent brief — for agents (DeepSeek / Claude / Opus)

Status: build-ready context.
Date: 2026-08-06.
Owner: Gleb.
Scope: turn Capture into a **limited personal agent** that understands Gleb, acts with him, files correctly, and improves from corrections. Not a general chatbot.

This file is the single source of truth. Read it fully before writing code.

---

## 1. What Capture is

Local-first personal capture app. One place to say things, three places for them to land.

- **Actions** — things to close. Shelf life by type. Stale → Faded → gone.
- **Threads** — things that accumulate. Summary ("Where this stands") rewritten from full history.
- **Intentions** — declared in present tense as already true. No checkbox, no due date.

Two ways in:
- **Capture** — files a thought as it comes out.
- **Distill** — asks one question at a time until the thought is clear, then files it the same three ways.

Voice supported. Model keys stay local. No account, no cloud sync.

## 2. The goal

Make Capture an agent that:

1. **Understands user** — learns Gleb's language, three kinds, filing patterns, corrections.
2. **Does things with user** — proposes board changes; Gleb approves one at a time.
3. **Improves** — every decision updates a personal model; next proposal is smarter.
4. **Files correctly** — Distill + ledger already do this; agent extends it safely.

"As good as Hermes" means **as good within Capture's domain**, not a general assistant. Hermes is broad and stateless between tasks. Capture should be **narrow and accumulate a personal model of one user**.

## 3. Core principle

```text
Agent suggests. User approves. Ledger records. Learning informs, never auto-mutates.
```

Adopted from research: proposal-card mutation, source-aware extraction, rebuildable indexes, explicit sync/export state, agent-readable state as a contract.

## 4. Repos researched (primary sources — read before building)

| Repo | URL | What to adopt | What to reject |
|---|---|---|---|
| NoteGen | https://github.com/codexu/note-gen | Approval panel (accept/cancel), narrow `once` scope, raw records stay valuable | General agent chat, MCP workbench, multi-format editor |
| Reflect Open | https://github.com/team-reflect/reflect-open | Tiny reversible proposal cards (Add/Ignore), derived task views, `needsReview` state | Markdown folder editor with wiki links |
| Reor | https://github.com/reorproject/reor | Similarity as advisory context, indexes are rebuildable caches | "Chat with all notes", auto-merge from vectors |
| Joplin | https://github.com/laurent22/joplin | Sync format ≠ export format, YAML front matter, explainable sync state | Unreadable synced Markdown as public contract |
| Logseq | https://github.com/logseq/logseq | Sync clarity, visible partial failure, no high-freq mirror writes | Graph/outliner, file-per-note sync |
| AppFlowy | https://github.com/AppFlowy-IO/AppFlowy | Source-aware action extraction (source IDs + quote) | Team/workspace/assignee fields |
| AFFiNE | https://github.com/toeverything/AFFiNE | Export needs snapshot tests | Docs/canvas/tables convergence |
| Anytype | https://github.com/anyproto/anytype-ts | Tools as app-owned commands over records | Generalized object graph / knowledge OS |
| Hermes Function-Calling | https://github.com/NousResearch/Hermes-Function-Calling | ChatML + function signatures + `<tool_call>` output | — |
| Hermes per-model prompts | https://github.com/NousResearch/hermes-agent/issues/508 | Match prompt style to model family | — |
| OpenHermes dataset | https://huggingface.co/datasets/teknium/openhermes | Model trained to act, not hedge — instruct directly | — |

Detailed research pack already in repo: `research/capture-limited-agent-repo-patterns.md`.
Architecture radar: `specs/capture-agent-architecture-radar.md`.
Hermes coworking notes (device-local, not in repo): `~/.hermes/skills/hermes-coworking/`.

## 5. Existing Capture files to read first

- `src/lib/model.ts` — Board, Action, Thread, Intention types.
- `src/lib/ledger.ts` — append-only capture record (raw → clean → kind/target/model). Union-by-id merge.
- `src/lib/related.ts` — deterministic local overlap/duplicate detection. Use for V1 proposals.
- `src/lib/distill.ts` — Distill hardening (sessions, question budget, `[ready]` strip).
- `src/app/api/distill/route.ts` — Distill endpoint.
- `src/hooks/useBoard.ts` — board mutations. Apply proposals through these.
- `scripts/export-capture.mjs` — Markdown mirror to `CaptureVault/`.
- `INTENTIONS.md` — why the three kinds exist.
- `README.md` — product pitch, provider chain.

Provider chain (no router): Groq → Mistral → Gemini → OpenRouter. Keys absent = tier skipped.

## 6. Function-calling shape (use this)

From Hermes-Function-Calling. Model returns proposals as tool calls; app applies one at a time.

```ts
export type CaptureProposal = {
  id: string;
  kind:
    | "rename_thread"
    | "clean_fragment"
    | "extract_action"
    | "combine_fragments"
    | "refresh_summary";
  title: string;
  reason: string;
  targetIds: string[];
  proposedText?: string;
  sourceQuote?: string;
  confidence: "high" | "medium" | "low";
};
```

Full schema + `<tool_call>` example: see `~/.hermes/skills/hermes-coworking/references/function-calling-schema.md` (device-local) or replicate from Hermes-Function-Calling repo above.

## 7. The learning loop (the differentiator)

```text
capture -> proposal -> Gleb decides -> correction recorded -> personal model updates -> next proposal smarter
```

### Correction ledger (extend existing ledger)

```ts
type CorrectionEntry = {
  id: string;
  at: number;
  proposalKind: CaptureProposal["kind"];
  accepted: boolean;
  context: string;          // what the fragment said
  correctionText?: string;  // what Gleb did instead
  rule?: string;            // "X is always a thread, not action"
};
```

### Personal model (derived, not stored as truth)

- V1: heuristics ("lines starting with 'need to' → action").
- V2+: grows from corrections ("Gleb filed 'test Mistral' as thread → remember").
- Injected as few-shot context into Distill/Review prompts: *"Here's how Gleb likes this filed."*

### Safety

Learning informs proposals. It never auto-mutates. Auto-merge/auto-delete from learning is rejected (Logseq warns why).

## 8. Staged build plan

### V1 — Propose, don't act
- Add `CaptureProposal` type (`src/lib/threadReview.ts`).
- Deterministic proposal generation using `related.ts`:
  - `rename_thread` (generic name → specific from summary)
  - `clean_fragment` (speech-to-text artifacts)
  - `extract_action` (todo/need to/remember to)
  - `combine_fragments` (overlap)
  - `refresh_summary` (thread changed)
- "Review thread" button on open thread → suggestion panel.
- Each card: Apply / Dismiss. Apply through `useBoard` mutations.
- Only high-confidence proposals show by default.
- Tests: proposal generation + apply paths.

### V2 — Learn from corrections
- Add `CorrectionEntry` to ledger.
- Every decision (apply/dismiss/correct) writes an entry.
- Derive personal model from entries.
- Inject top corrections as few-shot context into Distill + Review prompts.
- Add `suggestions.json` to export for agent-readable pending cards.
- Add failure states: `needsReview`, `lastTidyAt`, `lastTidyResult`.

### V3 — Understand semantically (optional, later)
- Local embedding index: rebuildable, advisory only, keyed by board version + model.
- Similar-thread hints feed proposals.
- Thread-to-draft export for founder notes (never auto-publish).
- Tools stay app-owned: `createAction`, `closeAction`, `mergeThreads`, `moveFragment`, `updateThreadSummary`, `createIntention`, `exportVault`, `draftFromThread`.

## 9. Hard constraints (do not violate)

- No auto-tidy / one-click rewrite / auto-delete.
- No general chat-with-notes.
- No plugin system / graph / wiki links.
- No model router. Provider chain stays Groq → Mistral → Gemini → OpenRouter.
- No two-way Markdown editing until conflict model is proven.
- Raw fragments preserved. Consolidation changes the lens, not the history.
- Every structural write requires proposal-card approval.
- Learning informs; never auto-mutates.

## 10. Verification before commit

```bash
npm run lint
npm run test
npx tsc --noEmit
```

Do **not** run `npm run build` if `npm run dev` is live on port 3000.
Verify routes return 200 where changed. No secrets in diff.

## 11. For the agent executing this

- Read section 5 files first.
- Build V1 only unless told otherwise.
- Use the `CaptureProposal` shape from section 6.
- Keep proposals deterministic in V1; model calls only when deterministic rules are insufficient.
- Apply through existing `useBoard` mutations — do not write board state directly from the model.
- Report what you built, what you deferred, and what to verify.
- Do not touch provider architecture or add a router.
- If unsure, propose; do not assume.
