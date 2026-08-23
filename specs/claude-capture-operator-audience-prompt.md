# Claude prompt: Capture for high-agency operators

You are working in the Capture repo.

Goal: scan Capture and evaluate whether the product can better serve founders, operators, investors, and other people whose time and attention are expensive.

Do not start by building. First inspect the product, understand the current UX and architecture, then produce a recommendation. If you make changes, keep them small and testable.

## Context

Gleb watched this video:

```text
I Met 94 Billionaires … Here’s 6 Things I Learned
https://www.youtube.com/watch?v=4t6x0Uuvm-A
```

The video argues that very wealthy operators often:

1. Prefer short text or voice-note communication over long calls.
2. Avoid wasting time on small decisions.
3. Guard trust carefully because many people try to use them.
4. Spend heavily on growth, but not on low-value possessions.
5. Focus on the work only they can do.
6. Have higher-quality problems that normal tools do not handle well.

Gleb's intuition:

Capture may already fit this pattern. It may not be a notes app. It may be closer to a private operating layer for people who need to turn messy thoughts into clear decisions, actions, and useful memory.

## Working thesis

Capture should not compete with Notion, Obsidian, Apple Notes, or generic second-brain tools on storage.

Capture should compete on:

- speed to clarity
- decision memory
- action extraction
- trusted private context
- surfacing the right thought at the right time
- reducing mental tabs
- helping a person decide what to do, delegate, drop, or park

Possible positioning:

```text
Capture is a private operating memory for founders and operators.
```

Alternative:

```text
Capture turns scattered thoughts into decisions, actions, and useful context.
```

Possible product promise:

```text
The fastest way to turn thought into action.
```

Avoid this framing:

```text
AI notes app for billionaires
```

It sounds shallow and status-chasing.

Use this audience instead:

```text
founders, operators, agency owners, investors, creators, consultants, and builders with multiple active projects
```

## Product lens from the video

### 1. Low-friction input

The video says high-value people text more than they call. The point is not texting. The point is low-friction communication.

Scan Capture for:

- fast text capture
- voice capture
- quick messy dumps
- mobile-first flow
- whether the product asks the user to organize too early

Question:

```text
Can a busy operator drop a thought in ten seconds and trust the system to sort it later?
```

### 2. No wasted time

Many productivity apps create work. They ask the user to tag, organize, maintain, and review.

Scan Capture for:

- places where the user must do extra organization
- unnecessary screens
- repeated decisions
- unclear next steps
- archive behavior without action

Question:

```text
Does Capture reduce work, or does it create another system to manage?
```

### 3. Trust and privacy

The video says wealthy operators are guarded. They protect trust because many people want access to them.

Scan Capture for:

- privacy posture
- local-first or private data assumptions
- whether sensitive thoughts feel safe in the app
- whether the product avoids social, public, or performative features
- whether AI actions ask for approval before mutation

Question:

```text
Would a guarded founder trust this with messy, sensitive, unfinished thinking?
```

### 4. Growth infrastructure

The video says wealthy people spend on growth, not low-value possessions.

Scan Capture for whether the value proposition is about:

- better thinking
- fewer dropped decisions
- faster follow-through
- less mental drag
- better operating leverage

Question:

```text
Does the product make a high-value person more capable, or does it only store notes?
```

### 5. Focus on unique work

The video says top operators focus on what only they can do.

Capture could help route a thought into:

- do it now
- delegate it
- drop it
- park it with a trigger
- turn it into a project
- add it to an existing project

Scan Capture for:

- action extraction
- decision handling
- project linkage
- whether it helps decide what deserves attention

Question:

```text
Does Capture act as an attention router?
```

### 6. Higher-quality problems

Do not optimize Capture for grocery lists, bookmarks, or generic journaling.

Scan Capture for use cases around:

- multiple businesses
- relationships
- opportunities
- negotiations
- decisions
- founder context
- personal operating memory

Question:

```text
Does Capture help with higher-quality problems that ordinary notes tools do not handle?
```

## Required repo scan

Inspect the current Capture repo before proposing changes.

Read or inspect at least:

- `README.md`
- `BACKLOG.md`
- `AGENTS.md`
- `specs/`
- current app routes and components
- capture/distill flows
- any existing proposal or agent system
- mobile UX assumptions

Important repo rule from `AGENTS.md`:

```text
This is not the Next.js you know. Read the relevant Next.js docs in node_modules before changing framework-sensitive code.
```

Do not invent APIs or routes. Trace existing code before editing.

## Expected output first

Before making code changes, produce a written analysis with these sections:

1. What Capture already does that fits this operator audience.
2. What fights this audience or creates friction.
3. What should be fine-tuned in product positioning.
4. What should be fine-tuned in UX.
5. What should be fine-tuned in the AI/agent behavior.
6. The smallest testable product change.
7. Things not to build yet.

Use file and route evidence from the repo.

## If you make changes

Only make small changes that improve the operator-audience fit.

Good possible changes:

- clearer homepage / onboarding copy
- better capture category language
- a stronger empty state
- a lightweight operator-use case example
- a small decision/action routing improvement
- documentation of the product thesis

Avoid:

- a large redesign
- new auth or billing
- social features
- public feeds
- dashboards that duplicate other apps
- automatic mutation without approval
- generic second-brain framing
- status-chasing copy about billionaires

## Quality bar

Capture should feel like:

```text
A private system that turns thought into action.
```

It should not feel like:

```text
A place to hoard notes.
```

Every recommendation should pass this test:

```text
Does this help a busy operator make, remember, or act on a decision faster?
```

If the answer is no, do not recommend it.

## Verification

If you only write an analysis, verify by citing the files you read.

If you edit code, run the relevant project checks. Start by inspecting `package.json` and existing scripts. Do not assume the commands.

Before final response, include:

- files read
- files changed
- recommendation
- smallest next build
- verification run
- blockers or uncertainty

## Important boundaries

- Do not commit unless Gleb explicitly asks.
- Do not push.
- Do not touch unrelated projects.
- Do not print secrets.
- Do not reframe Capture as an app for billionaires. Use the operator audience.
- Keep the product grounded in Gleb's existing principle: Capture is about knowledge application, not archiving.
