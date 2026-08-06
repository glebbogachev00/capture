# Distill intelligence — act on intent, stop over-asking

Status: **v2 built + verified** (conversational CLARIFIER; probe passes on the real chain; 22 unit tests).
Owner: capture / Gleb.
Open actions it closes: "Refine the capture feature to decide actions based on user prompt", "Improve the Distill Engine to reduce endless questioning and increase conversational intelligence".

**Implemented:** `src/app/api/distill/route.ts` (CLARIFIER + code-computed question budget in the chat branch), `src/lib/distill.ts` (`countAssistantQuestions`, marker helpers), `src/lib/distill.test.ts` (22 tests), `scripts/probe-distill.mjs` (pass criteria, requires the dev server).

## 2026-08-06 revision — the conversational CLARIFIER (v2, replaces v1)

v1's core move — *state the record you would file after every turn* — was rejected in use. Two problems it caused:

- **Filing talk leaked into the chat.** The engine said "I'd file this as a thread about…" mid-conversation, telling the user where things would go. The user is here to think; where a thought lands is decided invisibly at the end (the settle review already shows it).
- **Greetings were killed, not answered.** The v1 `[nothing]` marker waved "hello" off as "nothing to capture" and wiped the session — the user wanted a conversation, not a filing gate.

v2's rules (in `CLARIFIER`):

- **Never mention filing** — no kinds, no records, no "where this goes", no saving. Ever.
- **Meet the user in their own frame.** Greetings are answered warmly and the conversation stays open — a greeting never closes and never ends the session. The `[nothing]` marker is gone from the prompt; the client strips a stray one and simply continues.
- **Engage with real thoughts** in the user's own words (never parrot theirs), one question at a time, only when genuinely needed. Question budget is still code-computed, now a 3-question ceiling (a greeting's "what do you want to work on?" counts, so the cap has room for conversation).
- **Close only with `[ready]`** when something real has taken shape; the settle review then shows where it goes. Small talk never produces `[ready]`.

Probe scenarios now assert: no filing language in any chat reply, ≤2 questions, a greeting never closes, real thoughts close with `[ready]` within a few turns.

## Verification result (2026-08-06)

All five probe scenarios PASS twice in a row:
- every conversation states a draft first, never echoes the user's words;
- at most 1 question per conversation, never 2+ (budget held);
- a confirmation closes with `[ready]` on the next turn;
- the concrete case closes on turn 1 with 0 questions;
- the vague case reaches `[ready]` within 3 turns.

Two prompt iterations were needed during verification: (1) the draft must never lift the user's wording into it (a 5+ word echo in one scenario); (2) a draft must not end by appending the user's own sentence as a trailing explanation. Both are now explicit rules.

## The problem

The clarifying engine has exactly two verbs: **ask** (a question) or **ready** (`[ready]` → light the Distill button). That binary is the root cause of everything the user feels:

- **Endless questioning.** The CLARIFIER prompt says *"Only if something is genuinely missing, ask the ONE question"* — but "genuinely missing" is vague, the 2-question cap lives only in prose the model can drift past, and there is no code that counts how many questions have already been asked. The engine has no better verb, so it defaults to the one it has.
- **It doesn't act on intent.** The engine never *names what it thinks the user wants*. A half-formed thought is met with "what do you mean?" instead of "I think this is a thread about whether to leave your job, and it says X — right?" The draft that would show understanding only appears at the very end, after settle + review.
- **Settle is a cold pass.** The conversation is re-processed from scratch at settle time; the clarifier's own understanding is thrown away. The record can mismatch what the user felt the conversation settled.

## Design principle

> Superseded by the v2 revision above: the default move is now **conversing naturally**, and the record is decided invisibly at settle time. The v1 text below is kept for history.

The engine's default move becomes **proposing a record, not asking a question**. The only question it may ask is *about the proposal* ("is it X or Y?"), never open-ended ("tell me more"). Confirmation closes the conversation. Understanding becomes visible in the reply, not after.

## v1 scope (build this) — superseded, kept for history

### 1. Rework the CLARIFIER prompt (`src/app/api/distill/route.ts`)

New behavior, replacing the current "ask if something is missing" posture:

- **After every user turn, first state the record you would file** — name the kind and the shape: *"I'd file this as a thread about whether to leave the job — it says you're burned out but the money is good. Right?"*
- **The only question you may ask is a confirmation question about that draft** — "is it X or Y?", "does that match?". Never open-ended probes ("what exactly do you mean?", "tell me more").
- **When you're confident, or the user confirms the draft, reply `[ready]`** on the next turn — never follow a confirmation with another question.
- **A confirmation word ("yes", "right", "that's it", "correct") must produce `[ready]`, never a new question.**
- Keep the existing hard rules: never restate the user's words, one-to-three sentences, plain language, no lists, `[ready]` on its own line, nothing after it.

### 2. Enforce the question budget in code (structural, not prose)

The 2-question cap is currently a sentence in the prompt. Make it a fact the code computes:

- In the `chat` branch, count assistant turns in `body.turns` that end with `?` (after trim).
- Inject into the system prompt: *"You have already asked N question(s) across this conversation. Ask no more."* when N ≥ 1; when N ≥ 2, add: *"Reply `[ready]` — the user has answered enough."*
- This removes the model's self-counting drift: the number is real, and the cap cannot be talked past.

### 3. Client: no protocol change (v1)

Both the proposal and the close still end in `[ready]` — the existing marker stripping in `useBoard` (`MARKER = "[ready]"`, carry logic) keeps working unchanged. The draft the engine states is ordinary reply text; the user reads it in the bubble and confirms. The review step after settle stays exactly as it is.

### 4. Verification (mandatory — this is model-behavior work)

- **Probe script** (like the proofread pass) that runs the real chain against the three STARTERS, one concrete message ("I want to start a newsletter about brewing"), and one genuinely vague one ("I have an idea but it's fuzzy"). Pass criteria:
  - ≤ 1 question asked per conversation, never 2+;
  - a concrete draft stated by turn 2;
  - a confirmation ("yes") closes with `[ready]` on the next turn;
  - no restating of the user's words;
  - the vague case still reaches `[ready]` within 3 turns (rough record beats interrogation).
- **Live pass** in the app with the same five inputs, watching the button light.
- **Unit test** for the question-counting helper (empty transcript, one `?`, two, trailing-space edge).

### Not in v1 (deliberate)

- No UI change (no new bubble type, no proposal chip) — the proposal is text until the data structure earns one.
- No change to settle/polish/proofread ops.
- No board context yet (v2).

## v2 (superseded by the 2026-08-06 revision — now built as the conversational CLARIFIER)

- **Board-aware clarifier**: pass thread names + active action texts so the engine can say "this connects to your thread X" or "you already have this as an action" — the true "acts on intent" layer. Cost: more tokens per turn; gate behind a low-cardinality summary.
- **Settle reuses the conversation's draft**: the clarifier returns its proposal as structured data (`{ kind, title, clean }`) at `[ready]` time; settle confirms/refines it instead of cold-processing the transcript. Kills the draft-mismatch failure mode. Requires a protocol change (structured tail block or a second call).
- **Inline proposal affordance**: once the proposal is structured, render it as a distinct element the user can correct in place.

## Risks / honest caveats

- Prompt-only fixes drift with the model — the code-computed question cap is the part that cannot drift, which is why it's v1.
- The confirmation-question loop ("does that sound right?" → "yes" → "does that sound right?") is the failure mode to watch in the probe; the "confirmation must close" rule is the guard.
- Free-tier models may still over-ask; the probe script's pass criteria are the gate before we call it done.
