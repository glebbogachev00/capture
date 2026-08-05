# Backlog

Ideas I want to add to capture next, tracked in the open.

## ~~Voice — talk to it like a person~~ Built

The app sorts what you *write*. This was the next kind: what you *say*.

### Status

**Built.** Distill now has a full spoken conversation: tap the Voice button and you talk to the engine, it answers aloud (via Kokoro TTS running locally), and the mic re-arms itself for the next turn — tap the orb to interrupt. Dictation (speech-to-text into the box) is in both Capture and Distill. On your phone it runs through the Tailscale link to your Mac (see SETUP.md). The fallback chain and "never lose a capture" guarantees carried over unchanged.

### Why it fit

The three-kinds model does not care how the words arrived. Voice is just another input surface, so the "lock it down" and "never lose a capture" guarantees carried over unchanged.

---

## Distill intelligence — act on intent, stop over-asking (NEXT)

The clarifying engine still interrogates: it asks questions instead of proposing a record, so a user can be drawn into an endless back-and-forth that the settle step could have skipped.

- **v1 — "propose, don't interrogate"** (prompt-only, no architecture change): the engine's default move becomes drafting the record and asking for confirmation, not asking an open question. Zero questions when the first message is already concrete — respond with the draft and `[ready]` immediately. Question budget cut from two to one per conversation, and only when there is genuinely no shape to draft. Every question must be proposal-grounded ("does *this* match?") rather than abstract ("what exactly do you mean?"). Spec: `specs/distill-intelligence.md`.
- **v1 verification is mandatory** — this is model-behavior work, so the pass criteria are a probe script against the real clarifier (the STARTERS + a concrete message + a genuinely vague one) counting questions per run, plus a live pass.
- **v2 — board-aware clarifier**: pass thread names + active action texts so the engine can say "this connects to your thread X" or "you already have this as an action". The "acts on intent" layer.
- **v2 — settle reuses the conversation's draft**: the clarifier returns its draft as data (structured `chat` response, killing the `[ready]` marker-splitting in `useBoard`), and settle confirms/refines that draft instead of cold-processing the transcript.

## Tidy — on-demand board review (agreed, unbuilt)

A **button**, not a section, not automatic. Press it when the board feels messy; it scans the whole board with the existing related engine (`related.ts`) and proposes:

- **Thread ↔ thread merges** — two threads that phrase-match: "These are the same subject: *both mention 'espresso machine'*" → `[Merge into X]` `[Skip]`
- **Duplicate actions** — the `bestActionDuplicate` engine already exists: `[Remove duplicate]` `[Skip]`

Proposals appear in the existing suggestion-row UI. One tap merges or removes; the batch is undoable via the existing `captureSnapshot` machinery. Engine-only — no model, no quota.

Why on-demand and never automatic: an auto-running reviewer is the Related menu's noise at board scale. You press Tidy when you feel it. The engine stays phrase-exact on purpose — a merge moves your data, so a false positive is worse than a miss.

Cost: low — every piece exists (`hitsFor`, `mergeThreads`, `undo`, the suggestion row).

## Voice growth (candidates, none committed)

- **Hands-free wake word** on mobile, so you can start a spoken conversation without tapping.
- **Choice of voice / speed** for the spoken replies.
- **Push-to-talk on desktop** for the Capture box itself, not just Distill.

## Thread cover images (later)

Fun, Google-Keep-style covers for threads. Aesthetic only. Backlogged.

## Sync verification (unbuilt verification)

Sync shipped but was never confirmed device-to-device — the "desktop doesn't pick up phone updates" thread was parked when the preview broke. Needs one clean end-to-end pass: phone edit → hub → desktop, and the reverse, checking tombstones on both sides.
