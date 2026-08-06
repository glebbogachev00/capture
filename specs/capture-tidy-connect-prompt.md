# Capture — Tidy (Organize) + Connect-as-intelligence: build prompt for DeepSeek

Status: focused build prompt. Read AFTER `specs/capture-deepseek-build.md` and `specs/capture-deepseek-sprints.md`.
Date: 2026-08-06. Owner: Gleb.
Scope: TWO features only — (A) the Tidy/Organize board review, and (B) the Connect reframe: relationships used by intelligence, not displayed.

Important: Tidy is ALREADY BUILT as "Organize". Do not rebuild it. Extend it.

---

## A. Tidy / Organize — current state (read before touching)

Built in `src/lib/organize.ts`:
- `scanBoard(board, dismissed)` — pure, deterministic, no model. Returns `OrganizeProposal[]`.
- Kinds: `dup_action`, `dup_fragment`, `fold_action`, `merge_threads`, `move_fragment`, `extract_action`.
- `OrganizeProposal` carries: `id` (deterministic, dismissal-remembered-by-id), `kind`, `confidence` ("high"|"medium"), `verb`, `sourceId`, `targetId`, `reason` (always a shared phrase), `score`.
- Caps: `HIGH_CAP=12`, `MEDIUM_CAP=8`. Dismissed pairs stored at `capture:organize-dismissed`.
- UI: header wand button + Organize panel. Accepts route through `useBoard` mutations; records `related_suggestion` corrections.
- 16 unit tests. Live-verified.
- BACKLOG says move_fragment / extract_action cards were dropped as noise-prone. Keep that decision unless you have a precise, low-false-positive reason to revive them.

### What to build (extend, not rebuild)

1. **Event-triggered Tidy.** Today Organize only runs on button press. Add lightweight triggers so the scan also proposes when a meaningful event happens:
   - On action close/done: re-run `scanBoard` and surface ONLY new high-confidence proposals (diff against last scan result, stored at `capture:organize-last`).
   - On fragment added to a thread: check `related.ts` `bestThreadHome` / `bestFragmentDuplicate` for that fragment only; propose if strong.
   - Throttle: never scan on every keystroke. Debounce board changes (e.g. 800ms) and cap scans per minute.
   The goal: the wand badge lights when something is actually worth a look, without the user pressing it.

2. **Relationship-aware proposals (the Connect intelligence).** This is the core new feature. The old "Connect" was a graph view that showed links — rejected as useless (user does not want to stare at a graph of their own notes). Replace with: relationships are computed (already in `related.ts`) and USED to propose changes via the same proposal-card system. New trigger types, fired by events, each a proposal the user approves:

   - **action_resolved_in_thread**: when an action is closed, check if its text shares a phrase (use `sharedPhrase` / `sharedContentWords` from `related.ts`) with any thread fragment. If yes, propose: "You closed '<action>'. It came up in thread '<thread>'. Update the thread to mark it resolved?" → on accept, append a fragment to the thread like "Resolved: <action> (closed <date>)." This is Gleb's exact example.
   - **thread_matured_to_action**: a thread with >=3 fragments and no linked action, where fragments match `TASK_RE` pattern (see `organize.ts` extract_action) → propose extracting one action.
   - **intention_contradicted**: an intention's `expandedIntention` shares distinctive words with an action whose text pulls the other way (heuristic: action contains "skip"/"delay"/"snooze" near the intention's words) → propose "Your actions pull against intention (NN). Revisit?"
   - **same_idea_two_kinds**: a phrase appears in both a thread and an intention (or two threads) → propose keeping one kind.
   - **stale_thread_open_action**: a thread with no fragments in N days but an open action → propose a nudge.

   Each trigger returns an `OrganizeProposal`-shaped object (reuse the type; add kinds like `action_resolved_in_thread`, `intention_contradicted` if needed, but keep the same `id`/`confidence`/`reason`/`verb` shape so the existing panel + dismiss logic work).

3. **No new approval UI.** Route every new proposal through the existing Organize panel + `useBoard` mutations. Do not build a second card system.

4. **Corrections feed learning.** Every accept/dismiss of a relationship proposal records a `CorrectionEntry` (see `specs/capture-deepseek-build.md` Sprint 2 / `capture-deepseek-sprints.md` Sprint 2). If Sprint 2 is not yet built, still record `related_suggestion` corrections as Organize already does, and leave a clean seam for the richer ledger.

### What NOT to do
- Do NOT build a graph view, a "connections" page, or any display of links. Links are computed, never shown.
- Do NOT auto-apply any proposal. Approve-only.
- Do NOT use the model for Tidy proposals. Deterministic `related.ts` matching only. Model is for later ambiguous cases (out of scope here).
- Do NOT revive dropped cards (move_fragment, extract_action) without a precise precision argument.

---

## B. Connect-as-intelligence — design contract

Principle: **the relationship is infrastructure, the proposal is the product.**
- `related.ts` already computes connections honestly (phrase + rare-word, token-exact, generic words ignored). Reuse it. Do not write a second matcher.
- A connection's only job is to fire a proposal at the right moment.
- Proposals are rare and event-driven, not a constant stream.
- Every proposal is verifiable: its `reason` quotes the shared words, so the user can see why.

This makes Connect the "intelligence layer" Gleb wants: instead of "here are your connections," it says "I noticed X, want me to Y?"

---

## Files to read first
- `src/lib/organize.ts` — current Tidy/Organize engine. EXTEND this.
- `src/lib/related.ts` — connection math (`sharedPhrase`, `sharedContentWords`, `bestThreadHome`, `bestFragmentDuplicate`, `bestActionDuplicate`). REUSE.
- `src/hooks/useBoard.ts` — proposal accept path + mutations. ROUTE through.
- `BACKLOG.md` — Organize status (already built; read the deviations).
- `specs/capture-deepseek-build.md` — constraints (section 6) + correction ledger shape.
- `specs/capture-deepseek-sprints.md` — Sprint 1 (Tidy) + Sprint 2 (ledger) context.
- `research/capture-limited-agent-repo-patterns.md` — proposal-card UX (Reflect/NoteGen patterns).

## Verify
- `npm run lint` && `npm run test` && `npx tsc --noEmit` pass.
- New unit tests for each trigger type (action_resolved_in_thread at minimum).
- Organize panel still works for the original 6 kinds; new kinds appear only on their events.
- Dismissed proposals stay dismissed (id-stable).
- No model calls in Tidy. No auto-apply. No graph view.
- Do NOT run `npm run build` if `npm run dev` is live on port 3000.

## Report
State what you extended, what trigger types you added, what you deferred, and test counts. Commit only after verification. No secrets in diff.
