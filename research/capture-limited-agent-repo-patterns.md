# Capture limited-agent architecture radar

Research date: 2026-08-06. Scope: open-source note / PKM / AI-note repositories, read only as pattern sources. Capture should not copy these products wholesale; the filter is Capture's model: **actions close, threads accumulate, intentions are inhabited, Distill clarifies before filing**.

## Capture baseline inspected

- Capture README: local-first IndexedDB, no account/cloud sync, fallback preserves unsorted captures, and `npm run export:capture` mirrors board state to `CaptureVault/` for agents. Source: [`README.md`](../README.md).
- Capture model: `Action`, `Thread`, `Intention`, `Board`, action sweep, ledger re-export. Source: [`src/lib/model.ts`](../src/lib/model.ts).
- Capture ledger: append-only recent memory of raw -> clean -> kind/target/model; merge is union by id. Source: [`src/lib/ledger.ts`](../src/lib/ledger.ts).
- Capture related engine: strict local phrase / distinctive-word matches, no auto-links. Source: [`src/lib/related.ts`](../src/lib/related.ts).
- Capture Markdown mirror: snapshot export to `CaptureVault/actions.md`, `intentions.md`, `principles.md`, `threads/*.md`, `ledger.json`. Source: [`scripts/export-capture.mjs`](../scripts/export-capture.mjs).
- Backlog already agrees on **Tidy** as an on-demand board review button using existing related/duplicate engines and suggestion-row UI; it must not run automatically. Source: [`BACKLOG.md`](../BACKLOG.md).

## Repositories / primary sources inspected

### 1) Reflect Open — plain-file notes + agent-readable graph + reviewable suggestions

Repo: https://github.com/team-reflect/reflect-open

Inspected:

- [`README.md`](https://github.com/team-reflect/reflect-open/blob/master/README.md): plain Markdown files are the source of truth; app adds search/backlinks/related/AI; graph folder is user-inspectable; CLI exists for scripts/agents.
- [`apps/desktop/src/components/suggested-contact-card.tsx`](https://github.com/team-reflect/reflect-open/blob/master/apps/desktop/src/components/suggested-contact-card.tsx): suggestion card with **Add** / **Ignore**; Add merges into the note as plain Markdown; Ignore records suppression.
- [`apps/desktop/src/lib/note-task.ts`](https://github.com/team-reflect/reflect-open/blob/master/apps/desktop/src/lib/note-task.ts): tasks are extracted from Markdown checkboxes but writes serialize per note path, and busy/conflict states block unsafe toggles.
- [`apps/desktop/src/components/tasks/tasks-screen.tsx`](https://github.com/team-reflect/reflect-open/blob/master/apps/desktop/src/components/tasks/tasks-screen.tsx): global task view is derived from notes rather than a separate task database.
- [`apps/desktop/src-tauri/src/conflict/mod.rs`](https://github.com/team-reflect/reflect-open/blob/master/apps/desktop/src-tauri/src/conflict/mod.rs): deterministic conflict ladder; irreducible conflicts become labeled markers and `Needs review`.
- [`apps/desktop/src/components/settings/agents-section.tsx`](https://github.com/team-reflect/reflect-open/blob/master/apps/desktop/src/components/settings/agents-section.tsx): per-graph agent skill teaches agents to read the graph through CLI.

Patterns to adopt:

- **Suggestion cards are tiny reversible proposals.** Capture's Tidy cards should look like Reflect's contact cards: a reason, a positive action, a skip/ignore action, optimistic hide, and no background mutation.
- **Derived task/action views are safer than duplicating state.** Capture should keep actions as first-class records, but any future action extraction from threads should generate proposals against source fragment IDs, not silently copy tasks out.
- **Agent-readable state should have a documented entrypoint.** Capture already has `CaptureVault/`; add an `AGENTS.md`-style mini contract in the vault so Hermes/Claude/Codex know how to read actions, threads, intentions, and ledger without touching IndexedDB.
- **Review/conflict is a state, not an error toast.** If Tidy/export/sync detects ambiguity, park it as `needsReview` with inspectable evidence instead of doing nothing silently.

Patterns to reject:

- Do not become a full Markdown folder editor with wiki links/backlinks as the core model. Capture's source of truth stays the three-kind board; Markdown remains mirror/export.
- Do not import Reflect's broad task-management surface. Capture actions are intentionally shelf-lived and closing-oriented, not an all-notes checkbox manager.

### 2) NoteGen — capture inbox -> selected material -> AI draft, with agent approvals

Repo: https://github.com/codexu/note-gen

Inspected:

- [`README.md`](https://github.com/codexu/note-gen/blob/dev/README.md): “Capture first. Organize later”; raw records can be sentence/voice/screenshot/link/file/todo; later select records and organize into Markdown; AI is useful but user decides what to keep.
- [`src/app/core/main/chat/agent-approval-panel.tsx`](https://github.com/codexu/note-gen/blob/dev/src/app/core/main/chat/agent-approval-panel.tsx): pending tool/action confirmation panel with preview fields, warnings, expanded details, and accept/cancel.
- [`src/app/core/main/chat/agent-approval-actions.ts`](https://github.com/codexu/note-gen/blob/dev/src/app/core/main/chat/agent-approval-actions.ts): confirmation history, “once” vs conversation approval scope, explicit cancellation records.
- [`src/app/core/main/editor/markdown/markdown-export.ts`](https://github.com/codexu/note-gen/blob/dev/src/app/core/main/editor/markdown/markdown-export.ts): multi-format export pipeline from Markdown source.
- [`src/app/core/main/editor/markdown/sync/sync-tools.tsx`](https://github.com/codexu/note-gen/blob/dev/src/app/core/main/editor/markdown/sync/sync-tools.tsx): sync controls are visible and configuration-aware.
- [`src-tauri/src/mcp.rs`](https://github.com/codexu/note-gen/blob/dev/src-tauri/src/mcp.rs): MCP stdio server lifecycle management.

Patterns to adopt:

- **Limited-agent approval panel.** For Capture, every agent/tool mutation should produce a proposal card before changing the board: `merge threads`, `remove duplicate action`, `extract action from thread`, `consolidate fragments`, `rewrite summary`, `export draft`. Include exact source IDs and a preview diff.
- **Approval scopes stay narrow.** NoteGen supports broad session approvals, but Capture should start with `once` only. Maybe V3 adds “approve all Tidy duplicate removals in this batch,” never “agent can mutate board freely.”
- **Raw records remain valuable.** Capture's ledger is the right equivalent of NoteGen's records: keep it invisible but queryable/exported.

Patterns to reject:

- Do not add general agent chat, MCP server management, file browsing, canvas, or multi-format editor export as product surfaces. Capture is a limited task agent with known tools, not an agent workbench.
- Do not let AI organize arbitrary selected material into arbitrary writing forms inside the app. For Capture, thread-to-draft/export can exist, but filing still respects the three kinds.

### 3) Reor — local semantic retrieval and similar-note sidebar

Repo: https://github.com/reorproject/reor

Inspected:

- [`README.md`](https://github.com/reorproject/reor/blob/main/README.md): local AI PKM; every note is chunked/embedded; related notes auto-linked by vector similarity; Q&A uses RAG; works in one filesystem directory of Markdown files.
- [`electron/main/filesystem/filesystem.ts`](https://github.com/reorproject/reor/blob/main/electron/main/filesystem/filesystem.ts): only Markdown-like extensions are included in the file tree.
- [`electron/main/vector-database/lance.ts`](https://github.com/reorproject/reor/blob/main/electron/main/vector-database/lance.ts): LanceDB table names are keyed by embedding model and user directory; schema mismatch drops/recreates the table.
- [`src/components/Sidebars/SemanticSidebar/SimilarEntriesComponent.tsx`](https://github.com/reorproject/reor/blob/main/src/components/Sidebars/SemanticSidebar/SimilarEntriesComponent.tsx): similar entries are displayed and can be refreshed after saving the current file.

Patterns to adopt:

- **Similarity is advisory context, not authority.** Capture can eventually add optional semantic hints for Tidy/Distill, but phrase-exact local matching remains the safe V1 for merges/deletes.
- **Indexes are rebuildable caches.** If Capture adds embeddings later, treat them as disposable derived state keyed by board/export version and model, never as canonical memory.

Patterns to reject:

- Do not ship generic “ask all notes” as the primary AI feature. Capture's AI should answer only through bounded operations: clarify, suggest action extraction, summarize a thread, propose consolidation.
- Do not auto-link or auto-merge from vector similarity. Similarity can find candidates; user-approved proposal cards mutate state.

### 4) Joplin — offline-first sync metadata and intentionally lossy Markdown export

Repo: https://github.com/laurent22/joplin

Inspected:

- [`readme/dev/spec/sync.md`](https://github.com/laurent22/joplin/blob/dev/readme/dev/spec/sync.md): offline-first local database; sync target abstraction; upload soon after changes to limit conflicts; poll/download periodically; each item has `sync_time`; sync target `info.json` carries shared target properties with `updatedTime` fields.
- [Issue #5224: Markdown with YAML front matter export spec](https://github.com/laurent22/joplin/issues/5224): proposes Markdown+YAML export that preserves user-relevant metadata (title, created/updated, source URL, tags, todo completion/due); folder names map notebooks; internal links become relative file links; IDs/conflict status are intentionally lost because it is not lossless export.
- [Issue #228: Nextcloud notes integration](https://github.com/laurent22/joplin/issues/228): user confusion when sync target files are obfuscated/unreadable by other Markdown tools.

Patterns to adopt:

- **Separate sync format from export format.** Capture's `.data/sync.json` can remain lossless-ish machine state while `CaptureVault/` is human/agent-readable and can intentionally omit UI-only internals.
- **Use front matter for agent-readable Markdown.** Add stable YAML front matter to exported action/thread/intention Markdown: `id`, `kind`, `updatedAt`, `sourceLedgerIds`, `status`, `unsorted`, maybe `reviewState`.
- **Make sync state explainable.** Surface “last hub read/write”, device ID, tombstones count, and export snapshot time in a sync/debug page or vault README.

Patterns to reject:

- Do not use unreadable synced Markdown as the public/agent contract. Joplin #228 shows that “it is .md on disk” is not enough if filenames/content are app-internal.
- Do not promise lossless Markdown round-trip in V1. One-way mirror is enough until conflict semantics are proven.

### 5) Logseq — file-graph power and sync-conflict cautionary tales

Repo: https://github.com/logseq/logseq

Inspected:

- [`README.md`](https://github.com/logseq/logseq/blob/master/README.md): privacy/longevity/user-control positioning; DB version warns data loss is possible and recommends automated backups.
- [Issue #5240: iCloud for Windows duplicate files/crashes](https://github.com/logseq/logseq/issues/5240): frequent file saves plus iCloud can create duplicate files and data-integrity anxiety.
- [Issue #6972: duplicate journal page on iOS](https://github.com/logseq/logseq/issues/6972): iCloud conflict suffix creates renamed/duplicate journal files; maintainer identifies iCloud conflict suffix.
- [`./agents/skills/logseq-review-workflow/rules/modules/db-sync.md`](https://github.com/logseq/logseq/blob/master/.agents/skills/logseq-review-workflow/rules/modules/db-sync.md): deterministic/observable conflict handling; reject silent retry loops, swallowed errors, partial inconsistent writes.
- [`./agents/skills/logseq-review-workflow/rules/modules/import-export.md`](https://github.com/logseq/logseq/blob/master/.agents/skills/logseq-review-workflow/rules/modules/import-export.md): deterministic export for tests/version control; fail with actionable errors; surface partial failure.

Patterns to adopt:

- **Sync clarity beats sync ambition.** Capture should explicitly say which state is canonical on this device, which state is hub/mirror, and when export was generated.
- **Partial failure must be visible.** If export cannot write one thread or sees corrupt board data, create `CaptureVault/EXPORT_ERRORS.md` and fail non-zero.
- **No high-frequency file writes for the mirror.** Generate `CaptureVault/` on command or debounce aggressively; do not mirror every keystroke/fragments into many files.

Patterns to reject:

- Do not make the Markdown mirror the live editing/sync substrate yet. The Logseq/iCloud issues are a warning that file-per-note sync can create duplicate/conflict mess if writes are frequent and not protocol-owned.
- Do not build a graph/outliner/import-export universe. Capture only needs agent-readable state and controlled export.

### 6) AppFlowy — AI action items inside document/meeting blocks

Repo: https://github.com/AppFlowy-IO/AppFlowy

Inspected:

- [`CHANGELOG.md`](https://github.com/AppFlowy-IO/AppFlowy/blob/main/CHANGELOG.md): AI Transcript & Meeting Notes produce clean summaries and action items; action items can use mention person type for assignees.
- [`frontend/appflowy_flutter/lib/ai/service/appflowy_ai_service.dart`](https://github.com/AppFlowy-IO/AppFlowy/blob/main/frontend/appflowy_flutter/lib/ai/service/appflowy_ai_service.dart): AI repository streams completions and passes selected source/RAG IDs.
- [`frontend/appflowy_flutter/lib/ai/widgets/prompt_input/action_buttons.dart`](https://github.com/AppFlowy-IO/AppFlowy/blob/main/frontend/appflowy_flutter/lib/ai/widgets/prompt_input/action_buttons.dart): prompt input has explicit buttons for attaching/uploading/mentioning context.

Patterns to adopt:

- **Action extraction should be source-aware.** Capture thread cleanup can propose actions from a fragment/thread, but every proposed action should carry `sourceThreadId` + `sourceFragId` and a reason.
- **Explicit context selection.** Distill V2 should pass compact board context by mode (related threads/open actions/intentions), not the whole board by default.

Patterns to reject:

- Do not import AppFlowy's team/workspace/database action model. Capture is single-user; no assignees, databases, or collaboration fields in V1.

### 7) AFFiNE — block/canvas/doc convergence and Markdown adapter testing

Repo: https://github.com/toeverything/AFFiNE

Inspected:

- [`README.md`](https://github.com/toeverything/AFFiNE/blob/canary/README.md): local-first, real-time collaborative; docs/canvas/tables “hyper-merged”; AI can summarize/sort/turn outlines into outputs.
- [`blocksuite/affine/all/src/__tests__/adapters/markdown.unit.spec.ts`](https://github.com/toeverything/AFFiNE/blob/canary/blocksuite/affine/all/src/__tests__/adapters/markdown.unit.spec.ts): extensive Markdown adapter import/export snapshot tests.

Patterns to adopt:

- **Export needs snapshot tests.** Capture's Markdown mirror should have fixture tests for actions, faded actions, threads with images/unsorted fragments, intentions, duplicate thread slugs, empty boards, and ledger ordering.

Patterns to reject:

- Do not converge docs/canvas/tables inside Capture. That is a different product topology.

### 8) Anytype — local-first P2P object system and API/agents

Repo: https://github.com/anyproto/anytype-ts

Inspected:

- [`README.md`](https://github.com/anyproto/anytype-ts/blob/main/README.md): local-first, peer-to-peer, end-to-end encrypted knowledge OS; offline local storage; extensible through gRPC API and AI agents.

Patterns to adopt:

- **State can have an API later, but only after a stable file contract.** If Capture adds agent tools, start as app-owned commands over board records, not a general object API.

Patterns to reject:

- Do not model Capture as a generalized object graph/knowledge OS.

## Cross-repo architecture patterns for Capture

### Adopt

1. **Proposal-card mutation model**
   - Every limited-agent operation returns `SuggestionCard[]` with: `id`, `kind`, `title`, `reason`, `evidence`, `sources`, `preview`, `applyLabel`, `skipLabel`, `risk`, `createdAt`.
   - Cards apply through existing board mutation functions and snapshots/undo; skipped cards are remembered long enough to avoid nagging.
   - Start deterministic: duplicate actions, thread-thread merges, fragment-to-existing-thread moves, stale/faded review.

2. **Thread cleanup as on-demand review, not background magic**
   - Tidy scans when pressed.
   - It proposes one operation per card.
   - It never rewrites/merges/deletes automatically.
   - It explains with phrase-level evidence from `related.ts` or exact duplicate checks.

3. **Action extraction with provenance**
   - Extracted action proposal must point to the source fragment/thread and quote the line that implied the action.
   - Applying creates an `Action` and marks the source fragment with optional non-destructive metadata such as `extractedActionIds` later; V1 can rely on ledger/proposal history only.

4. **Consolidation as summary/fragment review**
   - Thread consolidation should first propose a replacement `summary` / “Where this stands,” not collapse raw fragments.
   - Raw fragments remain the audit trail. Consolidation changes the lens, not the history.

5. **Agent-readable state contract**
   - Keep `CaptureVault/` as the agent contract.
   - Add front matter and a vault README that tells agents: read `actions.md`, `intentions.md`, `threads/*.md`, `ledger.json`; do not edit mirror files as source of truth.
   - Later add `state.json` / `suggestions.json` if the limited agent needs a machine-readable queue.

6. **Local-first sync clarity**
   - Keep `.data/sync.json` as sync/hub state and `CaptureVault/` as export snapshot.
   - Display/write timestamps: board updated, hub updated, export generated, device/tombstone counts.
   - If export/sync partially fails, write explicit error state.

7. **Rebuildable intelligence indexes**
   - Any embeddings/semantic index is disposable derived state keyed by board version + model.
   - Deterministic matching remains the mutation gate for V1/V2.

### Reject

- Generic “chat with all notes” as a headline Capture feature.
- Two-way Markdown editing before sync/conflict semantics exist.
- Graph backlinks/wiki-link systems as primary navigation.
- Auto-merge/auto-delete based on AI or embeddings.
- Collaboration/team database fields.
- Broad agent permissions or MCP workbench inside Capture.
- High-frequency file-per-note sync/mirror writes.

## Capture-shaped roadmap

### V1 — deterministic limited-agent Tidy + stronger export contract

Goal: Capture becomes a safe board reviewer, not a chatbot.

- Add `SuggestionCard` domain type and queue:
  - `duplicate-action`
  - `merge-threads`
  - `move-fragment`
  - `extract-action`
  - `refresh-thread-summary`
- Implement **Tidy** button from backlog:
  - Uses `related.ts` / existing duplicate action logic.
  - Produces cards with exact evidence and source IDs.
  - Apply/skip only; undo via existing snapshot machinery.
- Add action extraction proposals from thread fragments:
  - deterministic first: lines starting with `todo`, `need to`, `remember to`, `decide`, `follow up`.
  - no automatic extraction.
- Harden export:
  - YAML front matter for each exported thread/action/intention.
  - `CaptureVault/AGENTS.md` or expanded `README.md` telling agents how to read state and that the mirror is read-only.
  - fixture tests for export shape and slug collisions.
- Add sync/export clarity fields to vault README: hub path, generatedAt, counts, warning if no hub.

### V2 — board-aware Distill and AI-assisted proposal generation

Goal: AI helps propose, but board writes stay card-gated.

- Distill receives compact board context:
  - top related threads by deterministic match,
  - active duplicate/similar actions,
  - relevant intentions/principles,
  - recent ledger entries.
- Distill response can emit a structured draft record reused by Settle.
- Tidy gains optional AI cards:
  - “These fragments belong in this existing thread because…”
  - “This thread summary is stale; proposed summary…”
  - “This fragment implies this action…”
- Add `suggestions.json` to export for agent-readable pending cards.
- Add proposal history / skip memory to avoid repeated nagging.
- Add failure states: `needsReview`, `exportErrors`, `lastTidyAt`, `lastTidyResult`.

### V3 — limited tools, local indexes, and controlled outbound artifacts

Goal: Capture is a bounded personal task agent with tools, not a general PKM.

- Tool layer exposes only known mutations:
  - `createAction`, `closeAction`, `mergeThreads`, `moveFragment`, `updateThreadSummary`, `createIntention`, `exportVault`, `draftFromThread`.
  - all destructive/structural tools require proposal-card approval.
- Optional semantic index:
  - local/rebuildable,
  - candidate-generation only,
  - never canonical.
- Thread-to-public-draft export:
  - produce Markdown founder/product note from selected thread + ledger evidence,
  - never auto-publish.
- One-way vault automation:
  - debounced/manual export with observable status,
  - maybe file watcher for agent workflows,
  - still no two-way Markdown edits unless conflict model is designed and tested.
- If multiple devices matter, add explicit sync diagnostics before adding new sync surfaces.

## Bottom line

The reference repos converge on one useful shape for Capture: **records stay raw, intelligence proposes, humans approve, exports are readable, sync state is explicit, and agent-readable state is a contract**. Capture should deepen its existing ledger/export/related spine before adding broad AI-note features.
