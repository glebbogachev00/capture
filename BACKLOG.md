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

## Thread cover images (later)

Fun, Google-Keep-style covers for threads. Aesthetic only. Backlogged.

## Sync verification (unbuilt verification)

Sync shipped but was never confirmed device-to-device — the "desktop doesn't pick up phone updates" thread was parked when the preview broke. Needs one clean end-to-end pass: phone edit → hub → desktop, and the reverse, checking tombstones on both sides.
