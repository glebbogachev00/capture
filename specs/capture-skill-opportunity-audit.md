# Capture — skill-opportunity audit (prompt for a research/audit agent)

Status: research brief. Read AFTER `specs/capture-personal-agent-brief.md` and `specs/capture-deepseek-build.md`.
Date: 2026-08-06. Owner: Gleb.
Goal: find where Capture's model calls can be made more efficient by adopting a **skill-like prompt system** — task-scoped prompts loaded on demand, not one wall of instructions per call. Also flag operations that should become reusable Capture "skills."

This is the audit step before Sprint 3.5 (prompt-skill store). Do not build; report findings + a proposed structure.

---

## What "skill" means here (the mechanism to copy)

A Hermes skill = a named, structured instruction bundle that loads into context ONLY when the task matches. The win: every model call carries exactly the instructions it needs, nothing more. Capture's server-side prompts (`src/app/api/*.ts`) already partially do this (separate CLARIFIER / SETTLER / POLISHER / PROOFREADER constants), but they are inline strings, not a loadable, composable store, and they do not adapt to the model tier.

The audit should confirm and extend this.

---

## What to investigate (ground in code, do not assume)

Read these files fully before concluding:
- `src/app/api/sort/route.ts` — the `prompt()` function, four `force` branches, `Sorted` schema.
- `src/app/api/distill/route.ts` — CLARIFIER / SETTLER / POLISHER / PROOFREADER constants, the `transcript()` builder, the chat/settle/polish/proofread ops.
- `src/app/api/intention/route.ts` — intention engine prompt.
- `src/lib/providers.ts` — the tier chain (Groq → Mistral → Gemini → OpenRouter). Note: tiers differ in capability; small/free tiers want terse prompts, strong tiers can take detail.
- `src/lib/ledger.ts` — the recent-context few-shot seed already injected into sort.
- `specs/capture-deepseek-build.md` Sprint 3 — the planned bounded personal model (top-5 corrections as few-shot).

---

## Questions the audit must answer

1. **Token waste.** For each model call, estimate how many prompt tokens are static instructions that do NOT apply to the current op. (e.g. SETTLER instructions sent during a proofread call? CLARIFIER budget text sent during settle?) Quantify the saving if prompts are split per-op.

2. **Tier-adaptive verbosity.** The provider chain already varies by tier. Should the prompt verbosity also vary? Small/free (Groq, our `tencent/hy3:free` analog) → terse single-shot; Gemini → can take detail. Give a concrete rule: which tiers get short prompts, which get full.

3. **Skill candidates.** List every Capture operation that should become its own loadable "skill" (prompt slice). At minimum:
   - sort (4 force-variants)
   - distill-chat, distill-settle, distill-polish, distill-proofread
   - intention
   - (future) Assistant ops, media-analyze, Connect triggers
   For each, state: current location, what's static vs dynamic, estimated token saving.

4. **Learned skills.** Sprint 3 plans top-5 correction rules as few-shot. The audit should propose the composition rule: given `(op, tier, corrections[])`, how to assemble the final system prompt from (a) base op skill + (b) tier verbosity + (c) top corrections. This is the "skill loader" design.

5. **Vocal / speech models (later phase — flag only).** Gleb wants eventual support for vocal models (speech-to-speech, or a voice-native model) in Capture. The audit should note where the prompt store would need to differ for a spoken interaction (e.g. shorter turns, prosody cues, no markdown) — but this is PHASE LATER, not now. Do not design it; just mark the seams.

---

## Deliverable

A Markdown report with:
- A table: operation | current prompt tokens (est.) | proposed skill slice | saving.
- A proposed `src/lib/prompts/` (or `skills/`) directory layout, with one file per op, and a `compose(op, tier, corrections)` loader spec.
- The tier-verbosity rule (which tiers get terse).
- The learned-skill composition formula.
- A one-line note on the vocal-model seam (later).
- A recommended build order: externalize prompts (low risk) → add tier verbosity → add correction few-shot (Sprint 3).

No code changes. This is the audit that precedes Sprint 3.5.

---

## For the auditing agent

- Use the `research` skill pattern: investigate against the repo (primary source), cite file:line for every claim.
- Do not modify any file. Report only.
- If a claim can't be grounded in the code, say so — do not invent token counts; estimate from the actual prompt strings and label them estimates.
- Output the report as a Markdown file in `research/` (e.g. `research/capture-skill-audit.md`).
