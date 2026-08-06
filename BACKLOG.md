# Backlog

Ideas I want to add to capture next, tracked in the open.

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

A **button**, not a section, not automatic. Press it when the board feels messy; it scans the whole board with the existing related engine (`related.ts`) and proposes:

- **Thread ↔ thread merges** — two threads that share a 3-content-word phrase: "These are the same subject: *both mention 'cold brew routine'*" → `[Merge]` `[Keep]`
- **Duplicate actions** — the `bestActionDuplicate` engine: the newer copy is always the one removed → `[Remove]` `[Keep]`
- **Duplicate fragments** — the same note pasted twice, same thread or across threads.
- **Fold an action in** — an action that clearly belongs with a thread.

### Status

**Built.** Header wand button with a live count badge opens the Organize panel. `scanBoard` (`src/lib/organize.ts`) is engine-only — no model, no quota — with a strict shared-phrase bar, a hard cap of 12 proposals, deterministic ids, and dismissed pairs remembered by id (`capture:organize-dismissed`). Accepts route through the existing `useBoard` mutations and record `related_suggestion` corrections; the scan re-runs on every board change so the badge lights as soon as a capture duplicates something. 16 unit tests. Live-verified on the dev board (duplicate rocket-checklist notes caught, removed, panel re-scanned clean). One spec deviation: move-fragment and extract-action cards were dropped as noise-prone — extract-action already exists per-fragment in the thread view, and move-fragment was part of the Related menu removed earlier.

## Voice growth (candidates, none committed)

- **Hands-free wake word** on mobile, so you can start a spoken conversation without tapping.
- **Choice of voice / speed** for the spoken replies.
- **Push-to-talk on desktop** for the Capture box itself, not just Distill.

## Thread cover images (later)

Fun, Google-Keep-style covers for threads. Aesthetic only. Backlogged.

## Sync verification (unbuilt verification)

Sync shipped but was never confirmed device-to-device — the "desktop doesn't pick up phone updates" thread was parked when the preview broke. Needs one clean end-to-end pass: phone edit → hub → desktop, and the reverse, checking tombstones on both sides.
