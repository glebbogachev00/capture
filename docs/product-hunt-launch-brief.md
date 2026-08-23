# Capture — Product Hunt launch brief

You are working in `~/Documents/capture`. Your job: get Capture ready to launch on
Product Hunt, so that a stranger who lands from the PH page gets the feeling in
under sixty seconds — *I said something messy, and it became something.*

Read this whole file before touching anything. Then read `README.md`,
`src/app/about/page.tsx`, and `src/lib/limiter.ts`.

## What Capture is (positioning — do not drift from this)

Capture is **not a notes app**. Nothing gets filed. Things get resolved.

You say a thought however it comes out. A model decides what it actually *was*
and it lands in one of three places: an **action** (closes, has a shelf life,
fades if it stops mattering), a **thread** (accumulates — a question that keeps
thinking), or an **intention** (a standing decision about your life). Distill is
the second door: a conversation for thoughts too tangled to say in a sentence.

The wound we are solving: *I keep saying things to myself that never become
anything.* Not "where do I file this." Every sentence of launch copy should be
checkable against that.

Lines that are settled and should appear verbatim where copy is needed:

- "Say it however it comes out."
- "Nothing gets filed. Things get resolved."
- "No open loops."

## The decision on pricing: free, no pricing page, no accounts

Capture launches **free**. Self-hosting is free forever (that is the product's
promise: your data, your keys, your server). The hosted playground is free with
rate limits. There is no Pro tier, no waitlist, no "upgrade" button anywhere.

Reasoning, so you can defend it if asked: a PH launch is a day of attention, and
every click that lands on a paywall is a click that did not land on the
feeling. The existing `/funding` page stays as a quiet "support this" link in the
footer — that is the only money-shaped thing on the site. Pricing, if ever, is
for hosting and sync convenience later, and will be decided with real users, not
before them.

## The one thing that must exist: a hosted "try it" that needs nothing

PH visitors will not clone a repo or paste an API key. They need a URL.

Capture is local-first, which makes this nearly free to provide: on a public
instance, **every visitor gets their own board in their own browser** (IndexedDB)
with no account and no shared state. The only shared cost is model calls, which
go through the server with the server's key. So the playground is: the existing
app, deployed publicly, with the password gate off and the model endpoints
rate-limited hard.

### Build it — acceptance criteria

1. **A public deployment** (Vercel, the existing setup) at a playground URL, with
   `APP_PASSWORD` unset so there is no login. Document the URL in this file's
   "Status" section when it exists.
2. **The model key is server-side only** (it already is — verify nothing leaks
   it to the client: grep the client bundle for the key prefix after a build).
3. **Rate limits that survive a front-page spike**, per IP, on every model
   endpoint (`/api/sort`, `/api/distill`, transcribe, TTS). Use the existing
   `limiter.ts`. Set them so one person can comfortably try ten captures and a
   Distill conversation, and a scraper cannot burn the key:
   - model: ~20 calls / 10 minutes / IP
   - distill: ~15 turns / 10 minutes / IP
   - TTS/transcribe: off or ~10 / 10 minutes / IP
   When a limit trips, the UI must say something human ("The playground is
   busy — try again in a few minutes, or run Capture yourself: it's free") — not
   a raw 429.
4. **A daily spend ceiling** on the key itself (provider dashboard) so the worst
   case is "the playground pauses," never a surprise bill. Note the cap here.
5. **A one-line playground notice** at the top of the board, dismissible:
   *"This is a playground. Your board lives in this browser only. Run Capture
   yourself to keep it."* — with a link to the README's two-minute setup.
   Do not add a signup prompt, an email capture, or a banner with a logo.
6. **The sixty-second test, performed in a real browser as a stranger** (use the
   browser tools; do not just reason about it): open the URL in a fresh profile,
   type *"fix the signup bug before friday and i keep going back and forth on
   pricing"*, press Capture. Within ~10 seconds an action and a thread must
   exist on the board, with the green "Landed in…" bar. Then open Distill, say
   one messy sentence, Send, and get a reply. If any of that needs explaining,
   the launch is not ready. Take screenshots and keep them in `docs/ph/`.
7. **Mobile.** Open the same URL at phone width and repeat step 6. PH traffic is
   half mobile.
8. **The empty state must teach.** A visitor's first screen is an empty board.
   The composer placeholder ("Say it however it comes out.") and the starter
   suggestions must be enough to know what to type. If you find yourself
   wanting a tutorial, fix the empty state instead.

### Do not build

- Accounts, sync for strangers, sharing links, analytics beyond what exists,
  a pricing page, a waitlist, a chatbot, a "what's new" modal, cookie banners
  (there are no third-party cookies; don't add any).
- Any change to the core product behaviour for the launch. Bugs, yes. Features,
  no. Every feature you add this week is a feature you cannot watch strangers
  react to.

## Launch assets — produce these files

Put everything in `docs/ph/`.

1. **Tagline** (≤ 60 characters). Use: `Say it messy. It becomes a task, a thread, or a decision.` (59). Provide two alternates.
2. **Description** (≤ 260 characters), from the positioning above. No feature
   lists. One sentence of wound, one of what it does, one of "free, local-first,
   yours."
3. **Maker's first comment** (~150–250 words). First person, the story: the
   11pm sentence that was two things; the 400-item list; "I built the thing
   where you don't decide." End with what it is *not* (a notes app) and that it
   is free and self-hostable. Keep the voice dry and specific; no exclamation
   marks, no emoji, no "excited to share."
4. **Gallery videos.** Five finished recordings already exist, made with Retake
   (Gleb's demo-as-code tool, in `~/Documents/Retake`):
   - `~/Documents/Retake/outputs/capture-two-places/demo.mp4` — the pitch (lead with this)
   - `~/Documents/Retake/outputs/mark-done/demo.mp4` — "No open loops."
   - `~/Documents/Retake/outputs/shelf-life/demo.mp4` — tasks that fade
   - `~/Documents/Retake/outputs/search-thought/demo.mp4` — find it without filing it
   - `~/Documents/Retake/outputs/distill-messy/demo.mp4` — Distill
   Product Hunt does not host video: the gallery takes **YouTube or Loom links**
   plus images. So: upload the landscape `demo.mp4` files above to YouTube as
   *unlisted*, titled plainly ("Capture — say it messy"), and put the links in
   `docs/ph/copy.md`. Lead with `capture-two-places`; `distill-messy` second.
   A square cut of `capture-two-places` also exists for X/feeds
   (`~/Documents/Retake/outputs/capture-two-places-square/demo.mp4`) — not
   needed for PH. Do not re-encode any of the videos yourself.
5. **Thumbnail** (240×240, animated GIF allowed): the board at the moment the
   green "Landed in 1 action · a new thread" bar appears. A still from
   `outputs/capture-two-places/stills/` is the source; crop to square.
6. **Topics:** Productivity, Artificial Intelligence, Open Source, Notes
   (yes, the category — the copy says what it isn't).
7. **Links:** the playground URL as the main link; GitHub as the second.

## Pre-launch checklist (all must be true)

- [ ] Playground URL loads in < 3s on a cold visit, mobile and desktop.
- [ ] Sixty-second test passes in a fresh browser profile, desktop and phone.
- [ ] Rate limits tested: the 21st call in 10 minutes gets the human message.
- [ ] Spend cap set on the provider; amount noted below.
- [ ] No secret in the client bundle (`grep -r "gsk_\|sk-" .next/static` empty).
- [ ] `/about` and `/funding` still work; README quickstart works from a clean clone.
- [ ] Gallery videos and thumbnail in `docs/ph/`, tagline/description/comment in `docs/ph/copy.md`.
- [ ] Launch day is a Tue/Wed/Thu; Gleb is free for the first two hours to answer comments.

## Report back

When done, write a short `docs/ph/STATUS.md`: the playground URL, the spend cap,
the rate limits as configured, the screenshots from the sixty-second test, and
anything a stranger is likely to trip on that you could not fix without
changing the product. Plain sentences. If something in this brief turned out
to be wrong about the codebase, say so rather than working around it silently.

## Status

_(fill in as you go)_
