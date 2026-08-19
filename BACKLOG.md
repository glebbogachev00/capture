# Backlog

Ideas I want to add to capture next, tracked in the open.

The authoritative build plan — the sprint list with per-sprint status — lives in
[specs/capture-deepseek-sprints.md](specs/capture-deepseek-sprints.md). The struck
sections below are the shipped features; the open items are what's left.

## ~~Voice — talk to it like a person~~ Built

The app sorts what you *write*. This was the next kind: what you *say*.

### Status

**Built.** Distill now has a full spoken conversation: tap the Voice button and you talk to the engine, it answers aloud (via Kokoro TTS running locally), and the mic re-arms itself for the next turn — tap the orb to interrupt. Dictation (speech-to-text into the box) is in both Capture and Distill. On your phone it runs through the Tailscale link to your Mac (see SETUP.md). The fallback chain and "never lose a capture" guarantees carried over unchanged.

### Why it fit

The three-kinds model does not care how the words arrived. Voice is just another input surface, so the "lock it down" and "never lose a capture" guarantees carried over unchanged.

---

## ~~Distill intelligence — act on intent, stop over-asking~~ v1 built

The clarifying engine interrogated: it asked questions instead of proposing a record, drawing users into an endless back-and-forth.

### v1 — "propose, don't interrogate" — **built + verified**

- The CLARIFIER's default move is now **stating the record** ("I'd file this as a thread about whether to leave the job — right?"), and the only question it may ask is a confirmation question about that draft.
- The **question budget is code-computed**: `countAssistantQuestions` counts assistant turns ending in `?` from the transcript, and the chat route injects "you've asked N questions, ask no more" into the prompt. Prose the model can drift past is gone.
- **Verified by `scripts/probe-distill.mjs`** against the real chain (login + the three STARTERS + concrete + vague): all five scenarios state a draft first, ask at most one question, never restate the user's words, and close with `[ready]` in 1–2 turns. Passed twice in a row on free tiers. Unit tests: 10 (`distill.test.ts`). Live UI pass: propose → confirm → the Distill button lights "it's ready".
- Spec: `specs/distill-intelligence.md`.

### v2 (unbuilt)

- **Board-aware clarifier**: pass thread names + active action texts so the engine can say "this connects to your thread X" or "you already have this as an action". The "acts on intent" layer.
- **Settle reuses the conversation's draft**: the clarifier returns its draft as data (structured `chat` response), and settle confirms/refines that draft instead of cold-processing the transcript.

## ~~Tidy — on-demand board review~~ Built (as Organize)

A **button**, not a section, not automatic. Press it when the board feels messy; it scans the whole board and proposes:

- **Duplicate actions** — the `bestActionDuplicate` engine: the newer copy is always the one removed → `[Remove]` `[Keep]`
- **Duplicate fragments** — the same note pasted twice, same thread or across threads.
- **Fold an action in** — an action that clearly belongs with a thread.
- **Move a note** — a fragment sitting in the wrong thread.
- **Lift a task out** — a note that is really an action → `[Extract]`.
- **The same idea twice** — one thought worded differently in two notes, which only the model can see → `[Merge]`.

(Whole-thread merges were in the original sketch and were **removed by the product rule**: Tidy never restructures for its own sake.)

### Status

**Built — v2, model-driven.** The wand button is always visible and scans **only when tapped** — never in the background, so the AI pass (which spends real quota) runs only when you ask, and a review stays frozen until you act on it. Two passes feed one review screen:

- **Instant local scan** (`src/lib/organize.ts`) — deterministic, free, word-based. Shows immediately.
- **AI semantic pass** (`/api/organize`, rev 3 of the spec) — the provider chain reviews the whole board and sees the same idea in *different words*, which word-matching never can. Live it caught: the espresso note sitting in the wrong thread, and a "call the vet" note that was really a task. Its rows carry an **AI** chip.

**Product rule (Gleb's directive): Tidy only reduces clutter / makes the board easier — it never restructures for its own sake. Whole-thread merges are gone entirely**, from the deterministic scan and the AI pass alike. Remaining kinds: dup_action, dup_fragment, fold_action, move_fragment, extract_action (a note becomes an action — explicitly wanted), merge_fragments. Nothing auto-applies: every claim is one yes/no on the review screen, with an **Approve all (N)** gated behind a confirm modal, and a failed extraction stays listed for retry. Dismissals are remembered by id; a resolved pair never nags again. Verified by 27 case-driven unit tests (`tidyCases.test.ts`) and a live probe through the real chain (`npm run probe:tidy:cases`) — which caught and fixed the model inventing tasks out of complaints.

## ~~Media — photos, seen and kept~~ Built (v1)

The app took photos, but stored them as multi-megabyte base64 strings, sorted image-only captures as the literal string "(image only)", dropped every photo on backup/restore, and shared text without the pictures.

### Status

**v1 built.**

- **Shrink at capture** (`src/lib/shrink.ts`) — every picked photo is downscaled to ≤1600px and re-encoded as WebP (JPEG fallback) before it touches IndexedDB. A 12MP phone photo goes from ~15MB to a few hundred KB.
- **Vision-aware sorting** — the sort route captions an attached photo through the vision tier (Gemini) and files the capture by what it shows: a photo of a coffee machine becomes a coffee thread, not a mystery "(image only)". The caption is a bonus layer — no vision tier, or a spent one, and the sort proceeds exactly as before.
- **Backups carry images** — backups v2 embed the photo bytes; restore brings them back, with an existing device image always winning over the backup's copy. v1 backups still restore.
- **Share carries the photos** — a thread share attaches its images as real files in the OS share sheet.

**Deferred on purpose:** video capture (needs an encode pipeline — ffmpeg/VideoToolbox, native-app territory) and web-page capture (SingleFile is a browser extension). Neither fits the PWA until it gets a desktop shell.

## ~~Bounded personal model — the app learns how you file~~ Built

Every accepted or dismissed suggestion is recorded in a correction ledger; `deriveRules` turns recent outcomes into a bounded set of plain-sentence filing rules, injected into the sorter as tendencies (never orders). The learned rules are visible and individually clearable in Settings.

## Voice growth (candidates, none committed)

- **Hands-free wake word** on mobile, so you can start a spoken conversation without tapping.
- **Choice of voice / speed** for the spoken replies.
- **Push-to-talk on desktop** for the Capture box itself, not just Distill.

## ~~Thread cover images~~ Built

Threads are little projects being built out — the app itself, bugs,
additions — so a cover is identity, not decoration: you recognise the thread
before you read its name. Chosen, never derived (most threads hold no photo,
so a picture pulled from the fragments would show nothing).

Eight muted tones from the app's own palette are the default path — eight
stored characters, no dependence on having taken a picture — and a photo
cover works too, shrunk and stored like any capture image so it syncs by the
same reconcile. Display only: the summary, the fragments and the sort engine
never see it, and a thread without a cover renders exactly as before.

## ~~Sync verification~~ Done 2026-08-19

Confirmed device-to-device. The hub went rev 4 → 6 and the phone's divergent
board (11 threads, 29 intentions) merged and won over the hub's stale Aug 14
state, with 149 tombstones applying correctly.

Two stacked causes had kept it broken for four days: Vercel Blob returns a
**weak** ETag (`W/"…"`) on larger bodies and `If-Match` requires strong
comparison, so every push of the real ~128KB board was rejected while a tiny
test payload succeeded — and the fix for that, plus the diagnostic logging
meant to reveal it, sat committed on an unpushed branch while production ran
older code. `/api/sync` POST also had an empty catch, so a push failing every
time for four days left no trace. It logs now.

**Lesson worth keeping: check what is actually deployed before diagnosing
anything else.** `npx vercel ls` / `inspect` / `logs` are authenticated on the
Mac.


---

# What's next — 2026-08-19

Everything below is open. Ordered by what unblocks what, not by size.

## Decisions waiting on Gleb

- **Back up both devices.** Skipped twice now. A lot changed today and the
  phone held the only copy of three intentions this morning.
- **"Bring intentions across" in Settings** — the import path from the old
  intent app. The board shows it has never been used: 117 ledger entries,
  zero imports, and the 29 intentions are numbered 1–31 sequentially from
  22 July, which is the pattern of things created here. Either do the
  migration and delete the section, or delete it now.
- **The heat-map streak line** (`23 days marked · longest run 5 in a row`).
  Kept for now — it is a fact about the record, not encouragement — but one
  line to remove after living with it.

## Next up — the public face

The engine is trustworthy enough to point people at, which was the blocker.
Nothing here should make the app itself noisier: the landing page explains
the hidden intelligence, the app performs it.

- **Move the app to `/app`, landing at `/`.** The structural unlock — the
  landing page has nowhere to live while `/` is the board. Needs a redirect
  plan and a manifest change, or the installed PWA opens the marketing page.
  This is the one with real hazard; do it deliberately.
- **Rewrite the landing page.** Open with the wound, not the claim. Make the
  first object a transformation, not a pitch. Sections worth having: what
  Capture refuses to become, local-first as an emotional argument ("your
  thinking system should not disappear because someone else's startup
  dies"), and a "for people who…" block of pain states.
  - The thesis line is **"It works best when you don't perform clarity."**
  - Use the **verified** demo, run eight times against the live sorter:
    `"uh fix the signup bug before friday and i keep going back and forth on
    usage based pricing vs seats"` → one action, one thread, every time.
  - **Do not** use the vet/boiler example. Both actions inherit one due date,
    so it publishes a visible bug.
  - Keep the mayfly and sediment metaphors; drop "altars".
- **X posts.** Same spine as the page. The material is in today's commit
  messages, and the failures are the good part: sync dead four days behind
  an empty catch; an app that offered to file a bug report into a list of
  bank account numbers because both said "three" and "items"; a fix that
  existed for three days on a branch nobody pushed.
- **Demo GIF.** `docs/demo-storyboard.md` is written and unused.

## Debt worth paying

- **Per-action deadlines.** A capture carries one `due`, so "fix the bug
  before Friday and call the vet tomorrow" stamps tomorrow on both. Hit this
  while choosing the empty-state demo sentence.
- **Distill settle reuses the clarifier's draft** rather than cold-processing
  the transcript (already listed above as Distill v2; still the right call).
- **Skip Groq for the Tidy route.** Its prompt is ~9.5K tokens against an 8K
  per-minute ceiling, so it can never fit and always falls through to
  Mistral — one doomed request per tap. Trimming context is the wrong fix;
  that pass needs the material it reasons over.

## Features considered and deferred

Kept here with the reasoning so they are not re-proposed from scratch.

- **Compost from faded actions** — "three faded actions mention posting about
  Capture; this may be a thread, not an action". Genuinely novel and the best
  idea left. Needs a fade record that outlives the two-week clear, since the
  evidence currently deletes itself. Route it through Tidy as a proposal;
  never a "you keep failing" surface.
- **Counter-intention detection from real captures.** Valuable, risky: a
  false accusation about your own intentions is worse than silence, and the
  model's judgement is measurably variable. Deterministic first (shipped as
  the revisit row), semantic later.
- **`/a`, `/i`, `/t` shortcuts.** Held because shortening the manual override
  optimises the path that used to bypass learning. Weaker objection now that
  commands teach, so a reasonable pickup.
- **Importing Apple Notes / Google Keep.** Declined. It contradicts the
  premise — a note from 2021 is an archive, not an escaping thought — Apple
  has no real bulk export, and 500 notes is 500 model calls of
  garbage-in. The good half is already built: frame **Distill** as the
  cleanout surface. "Paste your five oldest notes and see what's still
  alive." Triage, not migration.
- **Proofs list on intentions.** Superseded by the revisit row, which asks
  the same question without a visible list.
- **Current question for threads** — the summary already ends on the open
  question; a second generated field would double the prose.
- **Thread ripeness** — that is `extract_action`, already built.
- **Decision fossils, board weather, agent contract, share-shows-formation** —
  declined: cruft in an app about not accumulating cruft, analytics wearing a
  hat, speculative, low priority respectively.
- **Per-capture receipt in the capture flow.** Declined, correctly: the
  record screen already shows raw → cleaned → kind → time, conditionally, one
  tap behind the count, and undo already puts the raw words back in the box.
  Transparency is a claim, not a feature — make it on the landing page.

## Watch

- **Thread proliferation from images.** A capture carrying a picture opens a
  new thread when the sorter names no existing one, so the thread can echo
  its own action. Watch the count; the alternative is rendering images on
  actions and letting the picture die with the action.
- **Tidy runs on Mistral, not Groq** (see above). Fine, but know it.
- **Corrections lost before 2026-08-19 are gone.** A stale background summary
  write was reverting the ledger and corrections wholesale; re-filing lessons
  had been vanishing for an unknown period. Fixed; the engine accumulates
  from today.

## The rule these were filtered through

> Intelligence may increase. Surface area should not.
> If the user does not need to act on it, do not show it in the app.

With one addition earned the hard way today: **invisible when it works,
unmissable when it does not.** Three separate failures — dead sync, erased
corrections, a resurrected thread — all looked identical to working software
from the outside. Quiet intelligence needs loud failure.
