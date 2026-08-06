<p align="center">
  <img src="public/icon.svg" alt="capture" width="96" height="96" />
</p>

# capture

**One place to say things, three places for them to land.**

You speak or paste a half-formed thought. A model decides whether it is
something to close, something that accumulates, or something you are declaring
about your life — cleans up the wording, and files it. Nothing to categorise by
hand, no folders, no tags.

**Your data. Your keys. Your server.** capture is local-first and self-hosted:
your board lives in your browser's IndexedDB, your model keys stay on your own
machine, and there is no account, no third-party cloud, and no subscription.
Sync, when you use it, runs through your own machine — one command pairs your
phone and Mac over Tailscale. Built for one person's devices — yours.

<!--
  DEMO GIF — drop a screen recording here once you have one. Replace this
  comment with:
  <p align="center"><img src="docs/demo.gif" width="720" alt="capture in action" /></p>
-->

## The one-screen pitch

Open **Distill** and talk to it like a person. It asks one question at a time
until the shape of your thought emerges, answers aloud as you go, and turns
the mic back on when it finishes — a conversation, not a form. Stop when
you're clear, and one tap files the whole exchange as an **action**, a
**thread**, or an **intention** — proofread on the way out, so speech-to-text
slips never reach your notes. Unclear thought in, three tidy places to land.
That's the whole product; the rest of this page is how it works and how to run
it.

## The three kinds

**Actions** are things to close. They carry a shelf life judged from what they
are — a call to return fades in a day, a commitment to another person is kept
indefinitely. Stale ones move to Faded, recoverable for two weeks, then go.
Completed ones clear themselves after a week.

**Threads** are things that accumulate. Each new fragment joins the ones before
it, and the thread's "Where this stands" block is rewritten from the whole
history so it never drifts from what the fragments actually say. Threads never
expire; one with nothing new for two months moves to Resting.

**Intentions** are declared rather than closed. They are written in present
tense as already true, with the recurring behaviours pulling against them named,
and three actions taken from the fulfilled state — things you do *because* it is
already so, not steps toward making it so. They have no checkbox and no shelf
life on purpose.

## Two ways in

**Capture** files a thought as it comes out. **Distill** is for thoughts that
aren't clear yet: it asks one question at a time until the shape of it emerges,
then files the whole exchange the same three ways.

Both accept your voice. Dictation drops spoken words into the box; in Distill
there is also the full spoken conversation described above — you talk, it
answers aloud, and the mic comes back on its own. The complete voice + phone
setup lives in [SETUP.md](SETUP.md).

Photos ride along. They are shrunk the moment you pick them (a 12MP phone
photo stops being a 15MB blob), the sorter can *see* them when a vision tier
is configured — a photo of your coffee machine files under the coffee thread,
not as "(image only)" — backups carry them, and sharing a thread hands the
pictures over with the text.

When the board feels messy, tap the wand. The **Organize** review scans
everything on demand: duplicates, notes in the wrong thread, notes that are
really tasks, the same idea worded twice — the model's semantic pass catches
what word-matching can't. Every claim is one yes/no (or Approve all), and the
app's Undo puts a capture back exactly, words included.

## Quickstart

Needs Node 20 or newer. Two minutes, one key:

```bash
git clone https://github.com/glebbogachev00/capture.git
cd capture
npm install
cp .env.example .env.local
# add at least one model key to .env.local, then:
npm run dev
```

Then open http://localhost:3000. Nothing sorts until you add at least one
model key.

## The full setup

Quickstart gets you typing on one machine. For the whole thing —
human-sounding voice, your phone, always-on hosting — [SETUP.md](SETUP.md)
walks through it step by step:

- **Voice.** From browser dictation up to the near-human **Kokoro** voice
  running locally on your Mac, with the Microsoft Edge neural voice as the
  keyless middle tier and the browser voice as the last resort. Nothing breaks
  if a tier is missing.
- **Phone.** One command — `npm run phone` — builds, serves on the network
  under `caffeinate`, and exposes it over Tailscale with real HTTPS, so you get
  the same app (and the same voice) on your phone from any network.
- **Always-on.** Keep the Mac from sleeping, or deploy to any Node host —
  Vercel included — in a few commands.

## Model providers

Capture makes many small model calls — every capture sorts, every thread update
re-summarises, every edit is proofread — so it tries the fastest free tiers
first. A tier is skipped entirely when its key is absent, so one key on its
own is a complete setup.

| Order | Provider | Get a key | Notes |
|---|---|---|---|
| 1 | Groq | [console.groq.com/keys](https://console.groq.com/keys) | Very fast, generous free tier |
| 2 | Mistral | [console.mistral.ai](https://console.mistral.ai) | Fast fallback once configured; test account/model access directly, and the chain falls through on 429s |
| 3 | Google AI Studio | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) | Reliable free tier — the quality fallback |
| 4 | OpenRouter | [openrouter.ai/keys](https://openrouter.ai/keys) | Last resort — defaults to a `:free` model; paid models need a funded account |

Model ids are overridable (`GROQ_MODEL`, `MISTRAL_MODEL`, `GEMINI_MODEL`,
`OPENROUTER_MODEL`), so a retired model can be swapped without editing source.

When a capture carries a photo, the vision tier (Gemini) captions it first, so
the sorter files the capture by what it shows. The caption is a bonus layer:
no vision tier configured, or a spent one, and the sort proceeds exactly as
before — a capture is never blocked on an image.

If every provider fails, a capture is **never lost**. It is saved verbatim,
flagged unsorted, and routed by whatever you were looking at — an open thread
takes it as a fragment, the Threads tab starts a new one, otherwise it becomes
an action. A "Sort now" button runs it back through the engine once a provider
answers again.

## Locking it down

Set `APP_PASSWORD` and the whole app sits behind a single-user password gate.
Leave it unset and the gate is off entirely, which is fine on localhost.

**Set it in production.** The sorting endpoints cost real quota to call, and an
open deployment is an open tab on your account.

The cookie is an HMAC of an expiry timestamp keyed on the password, so it cannot
be forged without knowing it and stops working on its own after 30 days. This is
deliberately not a user system: one person, one password.

## Deploying

Any Node host works. On Vercel:

```bash
npm i -g vercel
vercel link
vercel env add OPENROUTER_API_KEY production
vercel env add APP_PASSWORD production
vercel deploy --prod
```

`vercel env add` reads the value from stdin and does not echo it.

## Installing it

It is a PWA. Open the deployed URL on a phone and add it to the home screen — it
runs full-screen, keeps its own icon, and opens offline.

## Where your data lives

In your browser's IndexedDB, on the device you're using. Not on a server, not
in an account. Captured text goes to your chosen model provider at the moment
you ask for it to be sorted, and nowhere else. If you pair your phone and Mac
with the sync command, the two devices merge through a hub on your own
machine — each device stays local-first, the hub just keeps them in step.

That also means **clearing site data deletes everything**. Settings has a
*Download backup* button that saves the whole board — photos included — as one
JSON file. Use it. Restoring merges by id, so restoring twice is safe, what is
already on the device always wins, and an older v1 backup restores fine too
(just without the photos).

## Exporting

A script mirrors the board into a plain Markdown vault — actions, threads,
intentions, principles, and the capture ledger (what you said, what it became,
where it landed, and which model tier handled it) — so an agent or any tool can
read your real Capture state without touching the app database:

```bash
npm run export:capture   # writes CaptureVault/
```

It reads the sync hub (`.data/sync.json` — the merged copy the Mac keeps when
you run `npm run phone`), so the vault reflects everything, phone included.

## Built with

Next.js 16 (App Router), React 19, the AI SDK, and no database.

## Support

capture is free and MIT-licensed. If it earns its keep on your phone, buy it a coffee — no tiers, no account, no pitch deck.

→ [ko-fi.com/banhmii](https://ko-fi.com/banhmii)

## Licence

MIT — see [LICENSE](LICENSE).

## Backlog

Ideas I want to add to capture next, tracked in the open.

→ [BACKLOG.md](BACKLOG.md)
