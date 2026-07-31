<p align="center">
  <img src="public/icon.svg" alt="capture" width="96" height="96" />
</p>

# capture

One place to say things, three places for them to land.

You speak or paste a half-formed thought. A model decides whether it is
something to close, something that accumulates, or something you are declaring
about your life — cleans up the wording, and files it. Nothing to categorise by
hand, no folders, no tags.

Built for one person's phone. Self-hosted, so the data and the API keys are
yours.

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

## Running it

Needs Node 20 or newer.

```bash
git clone https://github.com/glebbogachev00/capture.git
cd capture
npm install
cp .env.example .env.local
npm run dev
```

Then open http://localhost:3000. Nothing sorts until you add at least one model
key to `.env.local`.

## Model providers

Capture tries providers in order and uses the first that answers. A tier is
skipped entirely when its key is absent, so one key on its own is a complete
setup.

| Order | Provider | Get a key | Notes |
|---|---|---|---|
| 1 | Google AI Studio | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) | Good quality, tight request rate on the free tier |
| 2 | Groq | [console.groq.com/keys](https://console.groq.com/keys) | Very fast, generous free tier |
| 3 | OpenRouter | [openrouter.ai/keys](https://openrouter.ai/keys) | One key reaching many models — a useful last resort |

Model ids are overridable (`GEMINI_MODEL`, `GROQ_MODEL`, `OPENROUTER_MODEL`), so
a retired model can be swapped without editing source.

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
vercel env add GOOGLE_GENERATIVE_AI_API_KEY production
vercel env add APP_PASSWORD production
vercel deploy --prod
```

`vercel env add` reads the value from stdin and does not echo it.

## Installing it

It is a PWA. Open the deployed URL on a phone and add it to the home screen — it
runs full-screen, keeps its own icon, and opens offline.

## Where your data lives

In your browser's IndexedDB, on the one device. Not on a server, not in an
account. Captured text goes to your chosen model provider at the moment you ask
for it to be sorted, and nowhere else.

That also means **clearing site data deletes everything**. Settings has a
*Download backup* button that saves the whole board as one JSON file. Use it.
Restoring merges by id, so restoring twice is safe and what is already on the
device always wins.

## Built with

Next.js 16 (App Router), React 19, the AI SDK, and no database.

## Licence

MIT — see [LICENSE](LICENSE).

## Backlog

Features I want to add to capture, tracked in the open. One for now; the rest is room to grow.

→ [BACKLOG.md](BACKLOG.md)
