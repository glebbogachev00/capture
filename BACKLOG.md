# Backlog

Ideas I want to add to capture next, tracked in the open.

The first item on this list — **Voice** — shipped. What follows is the original plan, kept for the record.

## ~~Voice — talk to it like a person~~ Built

The app sorts what you *write*. This was the next kind: what you *say*.

### Status

**Built.** Distill now has a full spoken conversation: tap the Voice button and you talk to the engine, it answers aloud (via Kokoro TTS running locally), and the mic re-arms itself for the next turn — tap the orb to interrupt. Dictation (speech-to-text into the box) is in both Capture and Distill. On your phone it runs through the Tailscale link to your Mac (see SETUP.md). The fallback chain and "never lose a capture" guarantees carried over unchanged.

### Why it fit

The three-kinds model does not care how the words arrived. Voice is just another input surface, so the "lock it down" and "never lose a capture" guarantees carried over unchanged.

---

Room to grow. Candidate ideas (none committed yet):

- **Hands-free wake word** on mobile, so you can start a spoken conversation without tapping.
- **Choice of voice / speed** for the spoken replies.
- **Push-to-talk on desktop** for the Capture box itself, not just Distill.
