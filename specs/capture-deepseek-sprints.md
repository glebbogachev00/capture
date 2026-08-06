# Capture — DeepSeek sprint plan (phased, complexity-rated, resource-linked)

Status: build plan. Read after `specs/capture-deepseek-build.md`.
Date: 2026-08-06. Owner: Gleb.
Audience: the model executing the build (DeepSeek, or any agent on the Capture repo).

This doc turns the build brief into ordered sprints. Each sprint: what it is, why it matters, complexity, dependencies, verify, and the GitHub/resources to check. Build in order. Each sprint is independently shippable and verifiable.

---

## Guiding principles (from the session)

1. Reuse what exists. Do not build a parallel proposal system next to `useBoard`/`related.ts`.
2. Agent suggests, user approves. Never auto-mutate the board.
3. Cheap first. Deterministic logic before model calls. Opt-in vision, never automatic.
4. Local-first. Images shrink before store. Model sees media only on request.
5. Learning is bounded and inspectable. Rules must be clearable.
6. Verify every sprint: `npm run lint` && `npm run test` && `npx tsc --noEmit`. No `npm run build` while `npm run dev` is live on port 3000.

---

## Sprint 0 — Language parity (trivial, safe)

**What:** remove English bias from two spots.
- `src/app/api/distill/route.ts` PROOFREADER: add "user may write in any language, never translate."
- `src/hooks/useSpeech.ts`: pick TTS voice by detected language, fall back to `en`.

**Why useful:** Capture works for Vietnamese captures too. No language lock exists; this closes the two weak spots.

**Complexity:** 1/10. Two small edits. No schema/type change.

**Resources:** none (code only).

**Verify:** lint/test/tsc pass. No board/ledger impact.

**Depends on:** nothing. Do first.

---

## Sprint 1 — Finish Tidy (V1, deterministic proposals)

**What:** assemble existing `related.ts` + `useBoard` suggestion loop into the BACKLOG "Tidy" on-demand panel.
- Add a "Tidy" trigger on the board view.
- Scan threads + actions via `related.ts` deterministic functions (`bestThreadHome`, `bestActionDuplicate`, `bestFragmentDuplicate`).
- Produce suggestion cards: duplicate action, merge threads, move fragment, extract action, refresh summary.
- Deterministic only (no model calls). High-confidence shown; medium behind "show more"; low dropped.
- Apply each through existing `useBoard` mutations. Reversible via existing undo.

**Why useful:** delivers the "works with me" feeling at lowest risk. ~60% already built per the review.

**Complexity:** 3/10. Wiring, not new architecture.

**Resources to check:**
- `src/lib/related.ts` (read fully)
- `src/hooks/useBoard.ts` (read `computeSuggestion`/`acceptSuggestion`)
- `BACKLOG.md` (Tidy spec)
- Reference: `research/capture-limited-agent-repo-patterns.md` (NoteGen approval panel, Reflect proposal cards)

**Verify:** unit tests for suggestion generation + apply; lint/test/tsc; manual board check.

**Depends on:** Sprint 0 (parallel-safe, but do after for a clean base).

---

## Sprint 2 — Correction ledger (extend ledger.ts)

**What:** record every accept/dismiss/correct as a `CorrectionEntry`.
- Add type to `src/lib/ledger.ts`:
```ts
type CorrectionEntry = {
  id: string; at: number;
  proposalKind: "rename_thread" | "clean_fragment" | "extract_action" | "combine_fragments" | "refresh_summary" | "related_suggestion";
  accepted: boolean; context: string;
  correctionText?: string; rule?: string;
};
```
- Append on every suggestion outcome in `useBoard`.
- Union-by-id merge (like `mergeLedgers`).
- Export to `CaptureVault/corrections.json` in `scripts/export-capture.mjs`.

**Why useful:** cheap, safe, agent-readable. Unlocks V2 learning later. Value even before any learning.

**Complexity:** 2/10. Append-only record, no UI needed to start.

**Resources:** `src/lib/ledger.ts` (read merge pattern), `scripts/export-capture.mjs` (add export).

**Verify:** lint/test/tsc; export produces valid `corrections.json`.

**Depends on:** Sprint 1 (needs suggestions to record).

---

## Sprint 3 — Bounded personal model (visible, clearable)

**What:** turn corrections into a few-shot signal, capped and inspectable.
- Build on the recent-context few-shot already in `src/app/api/sort/route.ts`.
- Weight by `CorrectionEntry` (accept +, dismiss -).
- Hard cap: inject top 5 rules. Rank by recency + confidence.
- Surface "What Capture has learned about how you file" list. Each rule editable/clearable.
- Advisory only: changes the proposal, never the board.

**Why useful:** the differentiator. But dangerous if unbounded — a bad rule is invisible. Bounded + visible keeps it safe.

**Complexity:** 5/10. Prompt injection + UI + cap logic.

**Resources:**
- `src/app/api/sort/route.ts` (few-shot point)
- `research/capture-user-pain-language.md` (voice reference)
- Reference: `specs/capture-agent-architecture-radar.md` (V2 board-aware Distill)

**Verify:** lint/test/tsc; clearing a rule removes it from next prompt; no board mutation from rules.

**Depends on:** Sprint 2.

---

## Sprint 4 — Media capture + shrink (storage-light)

**What:** let Capture hold images, video, web pages; shrink before store.
- Images: `browser-image-compression` pattern + WebP/AVIF. `qoi` for lossless fast.
- Video: native VideoToolbox via ffmpeg, H.265 crf 28-32. AV1 if storage > encode time.
- Web: `SingleFile` (gildas-lormeau/SingleFile) single self-contained HTML.
- Apply at capture time so local-first stays light.

**Status — image half BUILT (v1, commit pending), video/web deferred.** `src/lib/shrink.ts`
shrinks every picked photo at capture time: downscale to ≤1600px long edge, WebP
encode at 0.82 with JPEG fallback, browser-native (canvas, no new dependency),
applied in `Capture.tsx` `addFiles`. Pure helpers unit-tested (`shrink.test.ts`);
live-verified 3000×2000 → 1600×1067.

**Deferred on purpose:** video needs an encode pipeline (ffmpeg/VideoToolbox —
native-app territory, not a PWA page), and SingleFile web capture is a browser
extension. Neither fits a self-contained Next.js PWA without a native wrapper,
so they stay out until Capture gets a desktop shell.

**Why useful:** captures more than text. Storage stays cheap.

**Complexity:** 6/10. New capture inputs + encode pipeline.

**Resources to check (GitHub):**
- Images: `Donaldcwl/browser-image-compression` (1.7k), `phoboslab/qoi` (7.5k), `addyosmani/squish` (1k)
- Video: `paulpacifico/shutter-encoder` (2.6k, FFmpeg reference), `xiph/daala` (560), `NVIDIA/NvPipe` (394, HW accel pattern)
- Web: `gildas-lormeau/SingleFile` (22k), `SingleFileZ` (1.9k)
- Full table: `research/media-reduction-scan.md`

**Verify:** lint/test/tsc; stored media is shrunk; export carries files.

**Depends on:** Sprints 0-3 (or parallel; media is independent of agent learning).

---

## Sprint 5 — Image-aware share / agent handoff

**What:** let the model and external agents see the photo with the text.
- Send `f.imgs` data URLs as image parts on opt-in vision calls only (Gemini / OpenRouter vision).
- Share fragment → multimodal message (text + image).
- Optional: `capture_get_fragment(id)` MCP tool returning text + image for Hermes/Claude/Codex.
- Fix export gap: `export-capture.mjs` writes image count today, not files. Write to `CaptureVault/threads/<slug>/assets/`.

**Status — v1 BUILT (commit pending).**
- **Vision-aware sort:** the sort route accepts one image, captions it via `visionChain()`
  (Gemini — the only vision tier in the default chain), and files the capture by what it
  shows. Verified live: a "COFFEE" image sorted as a *Coffee reminder* thread instead of
  "(image only)". Caption is a bonus layer — no vision tier, or a spent one, never blocks
  a capture (`src/lib/caption.ts`, unit-tested).
- **Backups carry images:** `buildBackup` embeds the image bytes (v2, v1 still restores),
  `restoreFromFile` writes them back to IndexedDB — a restore no longer silently loses
  every photo. Unit-tested round-trip.
- **Share carries the photos:** a thread share attaches its images as real files to the
  OS share sheet (`Shareable.imgIds` → `File[]`).

**Still open:** the vault export (`export-capture.mjs`) is text-only because image bytes
never leave the device (only ids live in the sync hub) — browser backup now covers
images, and the MCP `capture_get_fragment` tool remains a follow-up.

**Why useful:** your bug-report scenario — text + photo, agent sees both.

**Complexity:** 4/10. Multimodal message + share path. MCP tool adds 1 point if included.

**Resources:**
- `src/lib/storage.ts` (data URLs in IndexedDB)
- `src/app/api/sort/route.ts` (`raw || "(image only)"` already supports image source)
- `scripts/export-capture.mjs` (export gap)
- Hermes `hermes-agent` skill (MCP tool pattern)
- Full idea: device log `~/.hermes/gleb-decisions.md` (media + agent-scan PARKED)

**Verify:** lint/test/tsc; a vision call with image returns correct sort; export includes image files.

**Depends on:** Sprint 4 (needs media stored).

---

## Sprint 6 (deferred) — Assistant mode

**What:** third mode alongside Capture + Distill. Ask about app, run tasks, review threads.
- Uses `CaptureProposal` shape from `specs/capture-personal-agent-brief.md`.
- "Clean my threads" → runs Tidy scan, returns cards.
- "What did I capture about X?" → reads board, compressed context.
- Opt-in only. Deterministic first, model for ambiguous.

**Why useful:** the versatile agent surface. But credit cost is real — keep opt-in.

**Complexity:** 5/10. New surface + credit controls.

**Resources:** `specs/capture-deepseek-build.md` section 3, `specs/capture-agent-architecture-radar.md` (V3 limited tools).

**Verify:** lint/test/tsc; Assistant never auto-mutates; cost bounded.

**Depends on:** Sprints 1-3 (reuses Tidy + ledger + learning).

---

## Sprint 7 (deferred) — Embeddings / semantic index

**What:** local embedding index for "similar thread" advisory hints.
- Rebuildable cache, not memory. Advisory only.

**Why useful:** only when phrase-matching (`related.ts`) visibly fails on a large board.

**Complexity:** 6/10. Index build + invalidate + privacy.

**Resources:** `research/capture-limited-agent-repo-patterns.md` (Reor semantic sidebar pattern).

**Verify:** index rebuilds cleanly; hints are advisory.

**Depends on:** Sprints 1-3. Revisit only when board is large.

---

## Build order summary

| Sprint | Name | Complexity | Depends on | Status |
|---|---|---|---|---|
| 0 | Language parity | 1 | none | ✅ built |
| 1 | Finish Tidy | 3 | 0 | ✅ built (exceeded — v2 AI) |
| 2 | Correction ledger | 2 | 1 | ✅ built |
| 3 | Bounded personal model | 5 | 2 | ✅ built |
| 4 | Media capture + shrink | 6 | 0-3 | ✅ image half built; video/web deferred |
| 5 | Image-aware share | 4 | 4 | ✅ v1 built |
| 6 | Assistant mode | 5 | 1-3 | deferred |
| 7 | Embeddings | 6 | 1-3 | deferred |

Fastest path to "works with me": Sprints 0→1→2→3. That is the personal agent. Media (4→5) is a separate track. Assistant (6) and embeddings (7) are later.

---

## For the executing agent

- Read `specs/capture-deepseek-build.md` first (it has the constraints + file map).
- Read the resource files listed per sprint before editing.
- Do not create `threadReview.ts` — use Tidy (Sprint 1).
- Report what you built, deferred, and verified per sprint.
- Commit only after lint/test/tsc pass. No secrets in diff.
