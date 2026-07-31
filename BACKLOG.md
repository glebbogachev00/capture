# Backlog

Features I want to add to capture, tracked in the open. There is one for now; the rest is room to grow into.

## Voice — talk to it like a person

The app sorts what you *write*. The next kind is what you *say*.

You hit a key (or a hands-free wake word on mobile) and just talk — no text box, no paste. Capture listens, transcribes through a speech model you already have a key for, and feeds the words to the same sorting engine that already runs on your keystrokes. A fragment you spoke lands in the same three places: an action to close, a thread to accumulate, or an intention you declare.

It is the same product, mouth instead of fingers. Nothing to categorise by hand — you already decided that when you spoke.

### Why it fits

The three-kinds model does not care how the words arrived. Voice is just another input surface, so the "lock it down" and "never lose a capture" guarantees carry over unchanged.

### How it would work

- Speech-to-text through a provider you already hold a key for (Whisper via OpenRouter, or Groq's fast STT) — same fallback chain as the text model.
- While every provider is absent, voice capture falls back to "save verbatim, flag unsorted" exactly like today.
- On mobile it is a PWA intent; on desktop it is push-to-talk.

### Status

Not built yet. This is the only thing on the list right now.
