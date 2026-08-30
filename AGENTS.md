<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Engineering skills
When fixing bugs, reviewing diffs, researching, or planning significant work, consult the following installed skills under `~/.hermes/skills/engineering/`:
- `diagnosing-bugs` — disciplined bug loop
- `code-review` — Standards + Spec review before merge
- `research` — cite primary sources, write cited markdown
- `to-spec` — turn feature idea into a spec
- `to-tickets` — break plan/spec into tracer-bullet tickets
- `improve-codebase-architecture` — scan for deepening opportunities
- `domain-modeling` — sharpen terminology before building

## Before shipping a change — the checklist

Every item here is a class of bug this codebase has actually shipped, most of
them more than once. Run the list before committing; each takes seconds to
check and cost hours when skipped.

**1. Did you rebuild a Board anywhere?** The board is reconstructed
field-by-field in hydrate, sync merge, backup restore, and Undo — and every
one of those has silently dropped a field at least once (`wraps`,
`completions`, whole histories). Never rebuild by listing fields: spread the
original and override, and check `boardFields.test.ts` still reflects every
key. If you added a field to `Board`, grep all four rebuild sites today, not
after the bug report.

**2. Does it survive Vercel, not just localhost?** Functions die at 60s
(`maxDuration = 60` on every route; pace long work client-side). Env vars
live per project — `capture` and `capture-playground` have different keys;
`.env.local` never uploads. Preview shares production's hub: test against a
deploy with a dead hub (`UPSTASH_REDIS_REST_URL=http://127.0.0.1:1`) or you
are writing into the live board.

**3. Model calls: what happens when the provider is dead?** Groq's daily
limit is a rolling 24h window and both orgs have hit it in one day of
testing. Set `maxRetries: 0` on `generateObject` — the SDK default burns 3
backoff attempts per dead tier before falling through, which turned 4s sorts
into 30s ones. Every model feature needs a stated answer to "what does the
user see when every provider says no", and that answer must never be an
invented thread, a lost capture, or an empty panel that looks like a verdict.

**4. Green tests are not done.** The merge button said "Merge" while the
board said "Moved 22", with 675 unit tests and an end-to-end suite passing.
The judge returned zero verdicts that looked like unanimous rejection and was
an id-matching bug. Look at the artifact: run the change on a deployed
preview, screenshot or record it, and read what the screen actually says.
The suite's job is regressions; your eyes are the test for new behaviour.

**5. Does the user's escape hatch survive your change?** Undo lives inside
the landed banner — a timer that clears the banner deletes the only Undo
button. Failed sorts must park as unsorted actions, never mint threads. A
discard path must still write history. Ask: after this change, how does the
user get back what they just lost?

**6. Phones run yesterday's build.** The PWA holds old JavaScript until
`FreshBuild` catches up after a deploy. A bug report from the phone starts
with "which build is it on?" (`/api/version` vs what the phone shows) before
any code reading.

**7. Anything long-running: does the failure path give back what it took?**
The untangle gate claimed its 20-hour window before the work and kept it on
failure — a week of silence. Timers, quotas, locks, `asked-at` stamps: the
catch block returns them, and a test proves it.

**8. Main thread and IndexedDB are shared.** Commits stringify the whole
board into the same `kv` store the images read from; heavy writes stall every
`get(IMG(id))` behind them, and `disabled={busy}` across half the UI reads as
"the app froze" when a sort runs long. New work during a sort must not add
writes, and nothing new gets gated on `busy` without asking what it feels
like at 30 seconds.

Quick tests, in order: `npm run check` (lint, full suite, build, trace
guard) · `scripts/preview-verify.sh` (deploys an isolated dead-hub preview
and runs the recorded mobile suite against it — the gate that catches what
unit tests cannot; `--full` for all 28 steps) · one capture with the model
provider forced dead (`GROQ_API_KEY=broken`) · reload the PWA twice and
check `/api/version` agrees with the screen. When done:
`scripts/preview-clean.sh` — previews carry live model keys with no app
password, and leaving them standing is quota anyone can burn.
