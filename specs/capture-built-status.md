# Capture — built status (for external model context)

Date: 2026-08-06. Owner: Gleb.
Purpose: paste into DeepSeek/Claude so it does NOT rescan the app to rediscover built features. This is the authoritative "what exists" list. Read with `specs/capture-deepseek-build.md` (constraints) and `specs/capture-deepseek-sprints.md` (plan).

---

## BUILT — do not rebuild these

### Core capture + three kinds
- Text, dictated, and image capture. Sort into action / thread / intention via `src/app/api/sort/route.ts` + `src/lib/sort.ts`.
- "Both" kind (action + thread in one capture) — `sort.ts`, `model.ts`.
- Distill: spoken clarify → file. Propose-don't-interrogate, hard 2-question budget (`countAssistantQuestions`), `[ready]` marker. Routes: `src/app/api/distill/route.ts`, `src/lib/distill.ts`. Kokoro TTS local, mic re-arm.
- Ledger: append-only capture record (`src/lib/ledger.ts`), union-by-id merge, `LEDGER_CAP=500`.

### Sprint 0 — Language parity ✅
- Proofreader prompt: "any language, never translate" (`distill/route.ts` PROOFREADER).
- TTS detects language (`useSpeech.ts`). Commit `897f0f3`.

### Sprint 1 — Tidy (Organize), v2 model-driven ✅
- Wand button → tap-to-scan (never background). Two passes:
  - Deterministic local scan: `src/lib/organize.ts` (`scanBoard`). Kinds: dup_action, dup_fragment, fold_action, move_fragment, extract_action, merge_fragments.
  - AI semantic pass: `src/lib/organizeAi.ts` (`/api/organize`) — sees same idea in different words, misplaced notes, tasks. Returns `OrganizeProposal` shape, ids validated against snapshot, hallucinated ids dropped.
- Product rule: Tidy only reduces clutter; NO whole-thread merges. Every claim is one yes/no; Approve-all gated; dismissals remembered by id. 27 case tests (`tidyCases.test.ts`) + live probe.
- Commits: `245aa89`, `9eb0c60`, `d1119a4`, `5485da2`, `124cf7f`.

### Sprint 2 — Correction ledger ✅
- `CorrectionEntry` + `appendCorrections` + union in `src/lib/ledger.ts`. Recorded on every Tidy accept/dismiss.
- Exported to `CaptureVault/` (see export).

### Sprint 3 — Bounded personal model ✅
- `deriveRules` turns corrections into plain-sentence filing rules, injected into sorter as tendencies (never orders). Rules visible + individually clearable in Settings. Commit `8232eb6`.

### Sprint 4 — Media capture + shrink (image half) ✅ / video+web deferred
- `src/lib/shrink.ts`: downscale ≤1600px, re-encode WebP (JPEG fallback) at capture. 12MP → ~300KB. Browser-native, no dep.
- Vision-aware sort: photo captioned via vision tier (Gemini), filed by content, not "(image only)". `src/lib/caption.ts`.
- Backups + share carry images.
- DEFERRED (documented): video capture (ffmpeg/VideoToolbox, native shell) and web-page capture (SingleFile, browser extension). PWA can't do these yet.

### Sprint 5 — Image-aware share ✅ (v1)
- Thread share attaches images as real files. Sort captions photos. Full agent multimodal handoff still open (see below).

### Export / agent readability
- `scripts/export-capture.mjs` → `CaptureVault/`: actions.md, intentions.md, principles.md, threads/<slug>.md, ledger.json. Agent-readable Markdown.
- NOT YET: `graph.json` (connection index) — see open items.

---

## NOT BUILT — what's left

### Connect-intelligence (event-driven relationship proposals)
Designed in chat + `specs/capture-tidy-connect-prompt.md`, NOT coded. The old "Connect" graph view was rejected (user doesn't want to stare at links). Replacement: relationships (computed in `related.ts`) fire proposals at events, not a display. Trigger types specced:
- `action_resolved_in_thread` — close an action that a thread discussed → "update the thread?"
- `thread_matured_to_action` — thread with 3+ frags, no action → extract one.
- `intention_contradicted` — actions pulling against an intention → revisit.
- `same_idea_two_kinds` — phrase in both thread + intention → keep one.
- `stale_thread_open_action` — quiet thread, open action → nudge.
Route through existing Organize panel + `useBoard` mutations. No new card system. No model in Tidy (deterministic `related.ts` only).

### Agent connection index (`graph.json`) — Sprint 6 prerequisite
NOT coded. Plan: derive edges from `related.ts`/`organize.ts` into a `graph.json` (regenerated on board change), so the future Assistant navigates by edges, not full rescan. Advisory, rebuildable, NEVER rendered as UI. Agent reads `graph.json` + `CaptureVault/`, not the app DB.

### Sprint 6 — Assistant mode (third mode)
NOT coded. Capture + Distill exist; Assistant is the third: ask about app, run tasks ("clean my threads"), review threads. Uses `CaptureProposal` shape. Opt-in, deterministic-first, model for ambiguous. Depends on Connect-intelligence + graph.json.

### Sprint 7 — Embeddings / semantic index
Deferred. `related.ts` phrase-match suffices at personal scale.

### Other open (BACKLOG.md)
- Video capture, web-page capture (deferred, need native shell).
- Sync verification: device-to-device never confirmed end-to-end.
- Voice growth: wake word, voice choice, push-to-talk desktop.
- Thread cover images (aesthetic, later).

---

## For the model
- Start from the NOT BUILT list. The BUILT list is current as of commit `124cf7f`.
- Do not rebuild Organize, ledger, bounded model, shrink, language parity.
- Next highest-value builds: (1) Connect-intelligence triggers, (2) graph.json + Assistant.
- Verify: `npm run lint && npm run test && npx tsc --noEmit`. No `npm run build` if `npm run dev` live on 3000.
