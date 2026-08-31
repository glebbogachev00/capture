# What leaves your device, when, and to whom

This is the complete list. If something is not on it, it does not leave.
The code that could widen this list is guarded: provider failure logs are
sanitized (`src/lib/providers.ts`), and the build fails if private board
data enters the deployment trace (`scripts/check-trace.mjs`).

## Stays on the device

- **Your board** — actions, threads, intentions, principles, history,
  wraps, completion receipts — lives in the browser's IndexedDB.
- **Photos** are stored as bytes in the same database.
- The app works offline; nothing below is required to read or edit.

## Sent to the AI provider you configured (your keys)

The text of a capture is sent at the moment a model job runs, to whichever
provider your keys select (Groq, Mistral, Google, OpenRouter):

| When | What is sent |
|---|---|
| Sorting a capture | the capture's text, thread names and summaries |
| Dictating | the audio, for transcription and cleanup |
| Thread summaries | that thread's fragments (background, after a capture lands) |
| Daily wrap | the day's capture texts (background, once a day) |
| Tidy / untangle / judge | the texts being compared (only when you open Tidy) |
| Text to speech | the reply being spoken, when a remote TTS fallback is configured |

Failure logs never contain this text: on any provider error, only the
provider name, status code, and a bounded message are logged.

## Sync, only if you turn it on

One hub holds the merged board so your devices converge. You choose where
it lives:

- **Tailscale (private):** the hub is a file on your own machine; nothing
  touches third-party storage.
- **Hosted (e.g. Vercel + Upstash):** the hub is a Redis store in your own
  account; the full board and photo bytes are stored there, readable by
  that account's credentials. Rotate the token if it ever leaks.

## Working toward

Local model support, so sorting and summaries can run without any text
leaving the machine.
