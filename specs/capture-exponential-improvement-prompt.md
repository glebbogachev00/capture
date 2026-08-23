# Capture exponential improvement prompt

Use this prompt when you want Claude, Opus, DeepSeek, or another model to find high-leverage Capture improvements.

The goal is not more features.

The goal is a compounding system that makes Capture better at its real job: turn messy input into usable decisions, actions, threads, and intentions.

## Prompt to paste

```text
You are helping improve Capture.

Capture is a local-first personal thinking app.

It is not a notes app.
It is not a PKM graph.
It is not a chatbot.
It is not a productivity gamification app.

Its job:
Make thinking easier to capture, clarify, organize, apply, and share.

Core philosophy:
- Build for observed friction, not imagined feature count.
- Actions close.
- Threads accumulate.
- Intentions are inhabited, not completed.
- AI is quiet.
- Agent suggests, user approves, ledger records.
- Raw fragments are preserved.
- Learning informs future suggestions but never auto-mutates the board.
- Relationships are computed and used for proposals. They are not shown as a graph UI.
- Capture should make the user less dependent on AI over time.

Read these files first:
- VISION.md
- INTENTIONS.md
- specs/capture-built-status.md
- specs/capture-deepseek-build.md
- specs/capture-tidy-connect-prompt.md
- specs/capture-build-easy-paths-prompt.md
- src/lib/related.ts
- src/lib/organize.ts
- src/lib/organizeAi.ts
- src/lib/ledger.ts
- src/hooks/useBoard.ts

Do not propose work until you read the files.

Outcome:
Find one improvement path that could make Capture much more useful without violating its philosophy.

Do not give me a list of cool features.
Give me a compounding loop.

A compounding loop means:
1. The user captures something.
2. Capture understands something useful.
3. Capture proposes a small helpful action.
4. The user accepts, edits, or rejects it.
5. The ledger records the correction.
6. Future proposals get better.
7. The app stays quiet and local-first.

Use this graph shape:

Input event -> computed relationship -> proposal -> user decision -> ledger -> future rule

Examples of valid directions:
- Connect-intelligence that fires proposals only when a useful event happens.
- A thread review agent that turns one messy thread into clearer next actions.
- A correction-learning loop that makes sorting and Tidy better from user edits.
- A graph.json connection index for a future assistant, but only if it supports a real task.
- A share/export loop that turns a thread into a public artifact without becoming social media.

Examples of invalid directions:
- A graph view for the user to stare at.
- Generic chat with all notes.
- Auto-cleanup without approval.
- Tags, folders, and taxonomy work.
- Streaks, reminders, nudges, or productivity guilt.
- A second proposal system next to the existing Organize panel.
- A large rewrite.

Your task:

1. State the assumption you are challenging.
2. Name the observed or likely friction this solves.
3. Propose three possible compounding loops.
4. Reject two of them with reasons.
5. Pick one loop.
6. Draw the work graph in plain text.
7. Show the smallest V0 that proves it.
8. List exact files likely touched.
9. State what existing code does 80 percent of the work.
10. State what new code is required.
11. Define the user approval moment.
12. Define what the ledger records.
13. Define how the next proposal improves.
14. Give test commands.
15. Give a stop condition.

Output format:

## Assumption challenged

## First principles

## Three candidate loops

## Rejected loops

## Recommended loop

## Work graph

## Smallest V0

## Files likely touched

## Existing machinery to reuse

## New code required

## Approval and ledger design

## Verification

## Stop condition

Constraints:
- Do not write code yet.
- Do not redesign the app.
- Do not rebuild features marked BUILT in specs/capture-built-status.md.
- Do not create a parallel proposal system.
- Do not propose a graph UI.
- Do not add reminders, streaks, folders, tags, or social features.
- Prefer deterministic logic before model calls.
- Any model call must be opt-in or user-triggered.
- Any structural write must require user approval.
- Keep the V0 small enough to build in one focused session.
- If you are unsure, say what file or code path you need to inspect.
```

## How to judge the answer

Keep the answer only if it passes these checks:

1. It names one loop, not ten features.
2. It uses existing Capture machinery.
3. It has a user approval moment.
4. It records learning in the ledger.
5. It improves future suggestions.
6. It does not add a graph UI.
7. It keeps raw fragments intact.
8. It can be tested in one focused session.

If it fails these checks, ask the model to revise.
