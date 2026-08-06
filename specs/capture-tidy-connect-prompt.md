# Capture — Tidy ("keep it tidy") + Connect-as-intelligence: build prompt

Status: focused build prompt. Read AFTER `specs/capture-deepseek-build.md` and `specs/capture-deepseek-sprints.md`.
Date: 2026-08-06 (rev 3). Owner: Gleb.
Scope: TWO features — (A) **Tidy**, the AI board review (rename-friendly name: "keep it tidy"), and (B) **Connect**, relationships used by intelligence, not displayed.

**Rev 2 change — the one that matters:** v1 said *"Do NOT use the model for Tidy proposals."* That was a mistake and it made Tidy dumb. The deterministic word-matching engine can only ever see shared *words*; it cannot see that two fragments are the *same idea* when they are worded differently. **The model is now the intelligence layer for Tidy.** It reads the whole board, understands ideas and context, and proposes changes — including merging *individual fragments* across threads — that word-matching can never find. The deterministic engine stays as the instant, free, local first pass; the model adds the semantic second pass.

**Rev 3 change — the product rule.** Tidy exists to **reduce clutter and make the board easier to use — nothing else.** It never restructures for its own sake, never "tidies" something that is fine, and **never proposes whole-thread merges** ("merging one thread into another" is exactly the kind of unnecessary change the user rejects). Every proposal must be one of: *the same thing exists twice* (drop the copy), *this note is misplaced* (move it), *this note is really a task* (lift it into an action), *this action clearly belongs with a thread* (fold it in), or *the same idea lives in two notes in different words* (merge one fragment into the other's thread). The user's words: *"Only do things that will improve or make things easier for the user. Not adding unnecessary things like merging one thread into another. Just use intelligence to figure out how to reduce the clutter in the existing nodes, potentially make some existing nodes into actions."* If the model cannot find such a change, it proposes nothing — silence is the correct answer.

---

## The thesis (read first)

- Deterministic matching (`related.ts`) finds the **same words**: "cold brew" in two threads.
- The model finds the **same idea**: a fragment in "Morning routine" that is, in other words, the exact thought already in "Coffee rituals". Word-matching will never connect those; the model will.
- Tidy = the model reviews the whole board and proposes concrete changes, **one yes/no each**, in the existing review screen. Nothing is ever auto-applied. Every accepted change reduces clutter or turns a note into an action.
- Connect = the same intelligence used *quietly*: relationships are computed (local) and noticed (model), and only ever surface as a proposal at the right moment. Never as a graph.

---

## A. Current state (read before touching)

### The deterministic engine — KEEP, as the fast local layer

`src/lib/organize.ts` — `scanBoard(board, dismissed)` is pure, deterministic, no model, unit-tested (23 tests). Kinds: `dup_action`, `dup_fragment`, `fold_action`, `merge_threads`, `move_fragment`, `extract_action`. `OrganizeProposal` shape:

```ts
{
  id: string;            // deterministic, dismissal-remembered-by-id
  kind: OrganizeKind;
  confidence: "high" | "medium";
  verb: string;          // what the Accept button says
  sourceId: string; sourceName: string;
  sourceThreadId?: string; sourceFragId?: string;  // fragment kinds
  targetId: string; targetName: string;
  reason: string;        // verifiable — a shared phrase
  score: number;
  origin: "ai" | "local";  // added in rev 3: which pass proposed it
}
```

Caps: `HIGH_CAP=12`, `MEDIUM_CAP=8`. Dismissed pairs at `capture:organize-dismissed`. Matching rules live in `src/lib/related.ts` (`sharedPhrase`, `sharedContentWords`, `bestThreadHome`, `bestFragmentDuplicate`, `bestActionDuplicate`) — token-exact, generic words ignored. REUSE all of it; do not write a second matcher.

**Rev 3 removal:** `merge_threads` is **deleted from the deterministic engine too** — the product rule says the app never merges one thread into another. Remove the kind, its scan block, its tests, and its group in `Organize.tsx`. The `sharedContentWords` import may become unused once the merge_threads block goes — drop it if so.

### The UI — KEEP, it is what the user approved

`src/app/Organize.tsx` — a full-screen review (like Settings): one-line summary, findings grouped under headings, a confidence dot per row, and **one yes/no per finding** (Remove/Keep, Merge/Keep, Move/Keep, Extract/Keep). Medium-confidence items sit behind "Show more". The wand header button only appears when the scan finds something (progressive disclosure). Accepts route through `useBoard` mutations (`src/hooks/useBoard.ts`: `acceptOrganize`, `dismissOrganize`, `moveFrag`, `foldActionIntoThread`, `extractAction`, `deleteFrag`) and record `related_suggestion` corrections in the ledger. The badge re-scans on every board change via the `[loaded, data]` effect.

**The user's exact complaint about v1 (fix this, it is the whole point of rev 2 + 3):**
> "This feature doesn't have any intelligence. It just shows me threads that have the same words that I can merge into each other. An AI model should look at ideas, context — individual fragments that can be merged together."

---

## B. What to build

### 1. New route — `src/app/api/organize/route.ts` (the AI review)

Follow the exact pattern of `src/app/api/sort/route.ts`:

- `export const runtime = "nodejs"; export const maxDuration = 60;`
- Gate with `modelRateLimit(clientIp(request))` → 429 with `Retry-After` when spent.
- Validate the body with zod (reject with 400 on parse failure).
- Call `withFallback(async (tier) => generateObject({ model: tier.model, maxRetries: 0, schema, system, prompt, providerOptions: tier.providerOptions }))` — the existing chain (`src/lib/providers.ts`): Groq → Mistral → Gemini → OpenRouter, fail-fast.
- Errors through `explain(error)` from `@/lib/aiError`, return `{ error, status }`.

**Request body** — a compact board snapshot (not the whole `Board`; keep the prompt small and cheap). Zod schema:

```ts
const TidyAction = z.object({ id: z.string(), text: z.string(), src: z.string().optional(), done: z.boolean().optional(), faded: z.boolean().optional() });
const TidyFrag  = z.object({ id: z.string(), text: z.string() });
const TidyThread = z.object({ id: z.string(), name: z.string(), summary: z.string().optional(), frags: z.array(TidyFrag) });
const TidyIntent = z.object({ id: z.string(), raw: z.string().optional(), expanded: z.string().optional(), actions: z.array(z.string()).optional() });
const Body = z.object({ actions: z.array(TidyAction), threads: z.array(TidyThread), intentions: z.array(TidyIntent) });
```

The client sends `latest.current` mapped to this shape. Cap sizes server-side (e.g. first 60 actions, first 40 threads, first 15 intentions) so a big board can't bloat one call.

**Output schema** — the model returns proposals; the server validates and maps them into the existing `OrganizeProposal` shape:

```ts
const AiProposal = z.object({
  kind: z.enum(["merge_fragments", "dup_action", "dup_fragment", "fold_action", "move_fragment", "extract_action"]),
  confidence: z.enum(["high", "medium"]),
  sourceId: z.string(),                 // action id, or the THREAD holding the fragment
  sourceFragId: z.string().optional(),  // required for fragment kinds
  targetId: z.string(),                 // thread id or action id
  reason: z.string(),                   // a plain sentence the user can verify
});
const Result = z.object({ proposals: z.array(AiProposal) });
```

Note: **no `merge_threads` in the enum** — the product rule forbids it.

Server-side after the call:
- **Drop any proposal referencing an id that is not in the request body** (the model hallucinates ids; the route must not let them through).
- **Drop duplicates of the same pair** (same source+target+kind — the model sometimes proposes twice).
- **Map to `OrganizeProposal`** with a deterministic id: `` `ai:${kind}:${sourceId}:${sourceFragId ?? ""}:${targetId}` `` — the id embeds only stable item ids, so a dismissal still sticks across re-runs. Keep `score` (high = 200+rank, medium = 100+rank) so ordering matches the panel. Set `origin: "ai"`.
- Cap at 12 high + 8 medium, same as the local scan.
- Return `{ proposals, via }` (via = which tier answered, for the ledger).

### 2. The NEW kind: `merge_fragments` (the user's headline ask)

Two fragments in different threads that are the *same idea* worded differently. Semantics on accept: **move the source fragment into the target thread** (reuse `moveFrag(sourceThreadId, sourceFragId, targetId)` — it interleaves by date, carries images, re-summarises, and records its correction). This is the model-only capability: word-matching cannot see that "I keep meaning to dial back the evening caffeine" and "cutting the 4pm espresso" are one thought.

- `sourceId` = the thread holding the source fragment, `sourceFragId` = the fragment, `targetId` = the destination thread.
- The model must only propose this when the two fragments are genuinely the same idea — never merely same-topic. Confidence high only when it would stand behind the merge.
- Add to `GROUPS` in `Organize.tsx` under a heading like **"One thought, two notes"** with hint "The note moves into the thread that already holds this idea." Add `merge_fragments: "Merge"` to `YES_LABEL`.
- In `acceptOrganize` (`useBoard.ts`): route `merge_fragments` → `moveFrag(p.sourceThreadId!, p.sourceFragId!, p.targetId)` then `commit(noteCorrection(... accepted: true, context: "merged a note into " + p.targetName, rule: Move notes into "…"))`. A single-fragment source thread emptied by the move is deleted by `moveFrag`'s existing semantics — that is correct (it was one misplaced note).

### 3. The model prompt for Tidy

`system` + `prompt` built from the compact snapshot. The system must say, in the app's plain voice:

- You are capture's tidy engine. Below is a person's board — actions (things to do), threads (running notes, each with fragments), and intentions (states they're calling into being). Your job is to reduce clutter and make the board easier to use — nothing else.
- Propose only changes a person would immediately agree improve the board:
  - `merge_fragments` — the same idea living in two notes, in different words, in different threads. The strongest, most valuable claim; look for it first. The note moves into the thread that already holds the idea — one subject, one home.
  - `dup_action` / `dup_fragment` — the same task or note captured twice, worded differently. The copy is removed; the original stays.
  - `fold_action` — an action clearly belongs with a thread (it is really a note on that subject). Folding reduces the action list.
  - `move_fragment` — a note sitting in the wrong thread. If a note is clearly about another thread's subject (a groceries complaint belongs with the groceries thread), prefer this over `extract_action`.
  - `extract_action` — a fragment reads as a doable task (narrow: only when it is unambiguously a task, e.g. opens with "I need to…" / "remember to…"). The note becomes an action — this is explicitly wanted. A complaint or observation ("we're out of cold brew again", "the faucet drips at night") is NOT a task — never extract it, and never invent the task it implies.
- Rules that never bend:
  - **Never merge whole threads.** Two threads that cover overlapping ground stay separate; at most, an individual fragment that is truly the same idea in another thread may move.
  - **Same-topic is not the same idea.** "Morning routine" and "Coffee habits" both being about mornings is not a merge. Propose only when the substance overlaps.
  - **When in doubt, propose nothing.** A change that is not clearly an improvement is a change that must not happen. The user values a clean, quiet board over an over-organized one.
  - Never propose a change that would bury distinct content.
  - `reason` is a plain sentence the user can verify against their own words ("Both notes say the same thing: cut the afternoon espresso"), never a label like "similar keywords".
  - Do not invent tasks for `extract_action` — a complaint or observation is not a task — and do not move a note that also belongs where it sits.
  - Fewer, confident proposals beat many weak ones. High confidence = you would defend it. Medium = plausible but less certain. If unsure, medium or nothing.
- The prompt body: the board rendered compactly, e.g.:

```
Actions:
- [id] "text"
Threads:
- [id] "name" (summary)
  - [fragId] "text"
  - [fragId] "text"
Intentions:
- [id] "expanded"
```

### 4. Wiring — hybrid scan in `useBoard`

- `runOrganize` becomes async: run the **local scan first** (instant, sets the panel immediately), then fire the AI route and **merge** the results into the same `organize` state: AI proposals first (they are the semantic layer), local after, deduped by id, capped together at 12 high + 8 medium.
- If the AI route fails (no keys, quota spent, network): keep the local scan — the button still works, the badge still lights. The app never blocks on the model. Show a tiny "offline — instant scan only" note in the panel when only local results are present, so the user knows the semantic pass didn't run (only when the request actually failed; on first paint before the AI returns, show a quiet "thinking…" row instead).
- The badge re-scan effect stays local-only (free, instant, every board change). The AI pass runs on open, debounced (never on every keystroke; the effect that watches `[loaded, data]` must not fire an AI call per keystroke — gate it to a button press, or a 2s debounce on an explicit dirty flag).
- Rate limit is the server's job (`modelRateLimit`); the client just handles a 429 by keeping local results and showing the note.

### 5. Distinguish AI from local in the UI

Each row in `Organize.tsx` gets a tiny origin chip: **AI** (model-found, semantic) vs **instant** (local word-match). The chip is a quiet differentiator, not decoration — it tells the user why they're seeing a claim word-matching could never make. `OrganizeProposal.origin` is set by each pass ("local" in `scanBoard`, "ai" in the route).

### 6. Connect-as-intelligence — the quiet layer (section B of v1, now model-aware)

Keep the principle: **the relationship is infrastructure, the proposal is the product.** The model's Tidy pass is the "I noticed X, want me to Y?" layer. Event-driven additions that use the model *occasionally*, not on every keystroke:

- **action_resolved_in_thread** — when an action is closed, ask the model (one small call, `turns`-style) whether the thread that mentions this subject should get a "Resolved: …" fragment. Local `sharedPhrase` check gates it first so the model is only called when there is already a connection; the model decides phrasing.
- **thread_matured_to_action** — a thread with ≥3 fragments where the model sees a concrete recurring task → propose extracting one action (reuses `extractAction`). This is squarely inside the product rule: a note becomes an action.
- **intention_contradicted** — a live action whose text, per the model, pulls against a declared intention → propose a revisit.

Each fires a proposal through the same `OrganizeProposal` shape and the same panel. Do not build a second card system. Dismissals work exactly as today (id-stable). Every one of these is gated by the product rule: it must reduce clutter or make the board easier to use, or it does not fire.

### 7. What NOT to do

- Do NOT auto-apply anything. Approve-only, always.
- Do NOT build a graph view, a "connections" page, or any display of links.
- Do NOT remove or weaken the deterministic engine — it is the free instant layer and the fallback.
- Do NOT call the model on every board change or every keystroke. The AI pass is expensive and rate-limited; it runs on open and on explicit events, debounced.
- **Do NOT propose whole-thread merges — ever.** No `merge_threads` kind in the AI output, none in the deterministic scan. Threads stay put; only individual fragments move.
- Do NOT propose anything that is not a clear improvement. Silence beats a wrong proposal.
- Do NOT let a hallucinated id through: the route validates every proposal against the request body.

---

## Files to read first

- `src/lib/organize.ts` — deterministic scan. EXTEND (origin field, merge_fragments kind), REMOVE (merge_threads). 
- `src/lib/related.ts` — matching math. REUSE.
- `src/app/api/sort/route.ts` — the route pattern to copy (rate limit, withFallback, generateObject, explain).
- `src/lib/providers.ts` — the chain (Groq → Mistral → Gemini → OpenRouter).
- `src/app/api/distill/route.ts` — a second route pattern, plus the proofread/chat ops.
- `src/hooks/useBoard.ts` — `acceptOrganize`, `dismissOrganize`, `runOrganize`, `moveFrag`, `extractAction`, `noteCorrection`.
- `src/app/Organize.tsx` — the review screen to extend (origin chip, new group, new label, remove merge_threads group).
- `specs/capture-deepseek-sprints.md` — Sprint 2 ledger shape.
- `research/capture-limited-agent-repo-patterns.md` — proposal-card UX.

## Tests to write

- **organize.ts**: remove merge_threads tests; keep the rest passing; add an `origin: "local"` assertion on one scan output.
- **organizeAi.ts unit tests**: compact board builds and truncates; prompt renders ids; `mapAiProposals` drops hallucinated ids, dedupes same pair, produces deterministic `ai:` ids, caps high/medium, marks `origin: "ai"`; `mergeOrganize` merges AI-first with local, dedupes by id, caps.
- **Live probe** `scripts/probe-tidy.mjs` (mirror `scripts/probe-distill.mjs`): seed a board where the SAME IDEA is worded differently in two threads (the case word-matching cannot catch), hit `/api/organize`, assert the model proposes the fragment merge and proposes NO whole-thread merges. Pass criteria: the semantic case is caught, no hallucinated ids, no `merge_threads` kind, ≤ cap. Run it twice on free tiers.

## Verify

- `npm run lint` && `npm run test` && `npx tsc --noEmit` pass.
- Deterministic scan passes its (updated) tests, with `origin: "local"` on every row.
- AI pass on a real board finds a same-idea-different-words fragment merge; local scan finds its word matches; both render in the same panel with origin chips.
- **No `merge_threads` anywhere** — not in scanBoard, not in the AI enum, not in the UI groups.
- Dismissals stay dismissed across both passes (id-stable).
- No model call on keystrokes; 429 degrades to local-only, never an error screen.
- Do NOT run `npm run build` if `npm run dev` is live on port 3000.

## Report

State what you added, which kinds the AI pass produces, whether the semantic probe passed (and that no thread-merges were proposed), how AI and local results merge, and test counts. Commit only after verification. No secrets in diff.
