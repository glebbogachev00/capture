# Capture agent architecture radar

Status: proposed.
Date: 2026-08-06.

## Decision

Treat Capture as a limited agent, not as a chat agent.

Its job is not to answer any question. Its job is to act on captured thought with a small set of safe tools.

The next useful version is a thread-review agent:

```text
open thread -> review thread -> propose cleanup -> user approves one change
```

Do not build a broad agent workspace yet.

## What "agent" means for Capture

Capture can become agentic without becoming a general assistant.

An agent has:

1. State it can read.
2. Tools it can call.
3. Rules for when it may act.
4. A review boundary before important writes.
5. A log of what happened.

Capture now has the base pieces:

- Board state: actions, threads, intentions, principles.
- Capture Ledger: raw, clean, source, target, model path.
- Distill: conversation that proposes a record before filing.
- Related logic: local matching that can find specific overlap.
- Markdown export: a readable mirror for Hermes and other agents.

So the question is no longer whether Capture can be agentic. It already is, in a narrow way. The question is which tools it should get next.

## Sources inspected

### NoteGen

Source: https://github.com/codexu/note-gen
Docs: https://notegen.top/en/docs

Useful pattern:

- NoteGen separates capture from organization.
- It lets users collect text, screenshots, links, files, recordings, and todos first.
- Later, users filter records and use AI templates to organize selected material.
- Its docs say the agent can read or modify notes, folders, tags, records, and memories after the user approves tools.

Capture-shaped lesson:

- Keep fast capture separate from later review.
- Give the agent tools, but require approval for writes.
- Do not add a large writing editor or tag workspace.

Reject:

- Markdown editor gravity.
- Knowledge-base dashboard gravity.
- Agent mode with broad read/write permissions.

### Reor

Source: https://github.com/reorproject/reor

Useful pattern:

- Reor uses local files and vector search.
- Its README frames related notes as retrieved context for the human while writing.
- The human remains the generator in editor mode.

Capture-shaped lesson:

- Related material should appear beside the current work as a proposal.
- Retrieval should help the human decide, not answer for them.
- Board-aware Distill can use compressed context, but Capture should not become chat-with-notes.

Reject:

- Full RAG chat as the first agent layer.
- Semantic links that are hard to explain.
- A local vector database before deterministic thread review proves value.

### Khoj

Source: https://github.com/khoj-ai/khoj
Docs: https://docs.khoj.dev/features/agents
Blog: https://blog.khoj.dev/posts/create-agents-on-khoj/

Useful pattern:

- Khoj agents combine a prompt, tool access, and a knowledge base.
- The blog frames agents as shortcuts for repeated workflows.
- The docs let a self-hosted server define agents with custom prompts.

Capture-shaped lesson:

- Capture should not have one universal agent.
- It should have small named agents for repeated workflows.
- Each agent gets a narrow tool set.

Reject:

- Public agent marketplace.
- Generic assistant persona settings.
- Internet search inside Capture.

### Logseq

Source: https://github.com/logseq/logseq
Docs: https://docs.logseq.com/

Useful pattern:

- Logseq is local-first and block-based.
- Its docs expose the value of references, backlinks, and plugins.
- Its repo history shows how much complexity comes with a full knowledge graph.

Capture-shaped lesson:

- References are useful only when they produce a next action.
- Capture should keep links quiet and explainable.
- Plugins are not needed now.

Reject:

- Full graph UI.
- Block editor architecture.
- Query language.

### TriliumNext Notes

Source: https://github.com/TriliumNext/Notes

Useful pattern:

- Trilium is a mature personal knowledge-base system with scripting and self-hosting.
- It shows the power and cost of a programmable knowledge base.

Capture-shaped lesson:

- Do not add scripting to Capture yet.
- If tools arrive, they should be first-party and bounded.

Reject:

- User scripts.
- A plugin API.
- A personal wiki structure.

## Architecture principle

Use this rule for all future agent work:

```text
Agent suggests. User approves. Ledger records.
```

The agent can read context and propose tool calls. It must not silently rewrite, merge, delete, publish, or move important records.

## Proposed agent model

### Agent state

The agent can read:

- Current thread.
- Visible actions.
- Thread summaries.
- Intentions.
- Principles.
- Recent ledger entries.

It should not read the whole board by default. Use compressed context first.

### Agent tools

Start with first-party tools only:

```ts
type CaptureAgentTool =
  | "suggest_thread_rename"
  | "suggest_fragment_clean"
  | "suggest_action_extract"
  | "suggest_fragment_combine"
  | "suggest_summary_refresh";
```

Later tools can include:

```ts
type FutureCaptureAgentTool =
  | "suggest_thread_split"
  | "suggest_thread_to_public_draft"
  | "suggest_intention_from_thread"
  | "suggest_archive_or_rest";
```

Do not expose raw board mutation functions to the model.

### Agent output

The model should return proposals, not mutations:

```ts
type CaptureProposal = {
  id: string;
  kind:
    | "rename_thread"
    | "clean_fragment"
    | "extract_action"
    | "combine_fragments"
    | "refresh_summary";
  title: string;
  reason: string;
  targetIds: string[];
  proposedText?: string;
  confidence: "high" | "medium" | "low";
};
```

Only high-confidence proposals appear by default. Medium-confidence proposals can appear behind "show more." Low-confidence proposals do not show.

### Agent application

Apply a proposal through normal app functions.

Do not let the model write directly to the board.

The UI decides which mutation to run:

- `rename_thread` calls the existing rename path.
- `clean_fragment` opens a review diff before save.
- `extract_action` uses an existing or new extract-action path.
- `combine_fragments` creates a reviewed combined fragment and keeps source trace.
- `refresh_summary` calls summary regeneration.

## V1: Thread Review

Build this first.

### UX

Button label:

```text
Review thread
```

Location:

- Open thread view.
- Near the existing thread controls.
- Hidden when the thread has fewer than two fragments unless actions can be extracted.

Panel title:

```text
Suggested cleanup
```

Suggestion card shape:

```text
[Kind]
Suggestion title
Reason
Preview
[Apply] [Dismiss]
```

### Suggestion types

#### Rename thread

Appears when:

- Thread name is generic.
- Summary or fragments suggest a more specific name.

Must not:

- Rename automatically.

#### Clean fragment

Appears when:

- A fragment has speech-to-text artifacts.
- A fragment has filler or obvious typos.

Must not:

- Change meaning.
- Rewrite the whole thread.

#### Extract action

Appears when:

- A fragment contains a concrete task or commitment.

Must not:

- Remove the source fragment.
- Invent a task.

#### Combine fragments

Appears when:

- Two or more fragments repeat the same point.

Must not:

- Delete originals in V1.
- Merge low-confidence overlaps.

V1 can add a new combined fragment and mark the originals in the reason. Deletion can wait.

#### Refresh summary

Appears when:

- The thread has changed since the summary was last updated.

Must not:

- Change fragments.

## V2: Board-aware Distill

After Thread Review works, make Distill aware of nearby state.

Input context:

- 5 active actions.
- 5 likely related threads.
- Current intentions.
- Enabled principles.

Behavior:

- The clarifier can say, "This looks connected to X."
- It still proposes one record.
- It does not become chat with all notes.

Why after V1:

- Thread Review proves the proposal pattern.
- It also gives us a suggestion data shape.

## V3: Capture tool agent

Only after V1 and V2 prove useful.

Add a narrow agent surface:

```text
What should I do with this thread?
```

The agent can call a fixed set of internal tools:

- find related records
- propose actions
- propose thread split
- draft public note
- propose intention
- refresh summaries

Every tool returns a proposal. The user approves writes one at a time.

Do not add:

- autonomous background edits
- web search inside Capture
- plugin marketplace
- custom public agents
- generic chat with the board

## Tool boundary

Capture tools should use this permission model:

| Tool | Reads | Writes | Approval |
|---|---|---|---|
| find related records | board summary | none | none |
| suggest rename | one thread | none | apply required |
| clean fragment | one fragment | none | diff required |
| extract action | one fragment | action after approval | apply required |
| combine fragments | selected fragments | new fragment after approval | apply required |
| refresh summary | one thread | summary | apply required |
| draft public note | one thread | draft only | approve/export required |

## What to build next

Build V1 only:

```text
Review thread -> proposal panel -> one approved operation at a time
```

Implementation sequence:

1. Add proposal types in `src/lib/threadReview.ts`.
2. Generate deterministic proposals first:
   - candidate rename from summary/title quality
   - overlap using `related.ts` style token logic
   - action extraction only if a model call is needed
3. Add `/api/thread-review` only when deterministic rules are not enough.
4. Add a small panel in the open-thread view.
5. Apply proposals through existing `useBoard` functions.
6. Add tests for proposal generation and apply paths.

## What to defer

Defer these until usage proves the need:

- vector search
- embeddings
- plugin system
- autonomous cleanup
- whole-board agent chat
- automatic background reviews
- one-click full-thread tidy

## Final recommendation

Capture should become an agent with limited tools.

The right first agent is not a chatbot. It is a review worker:

```text
It reads one thread.
It proposes the next useful cleanup.
You approve or dismiss.
The ledger keeps the record.
```

This keeps Capture's identity intact:

```text
Capture fast.
Threads accumulate.
Agent proposes.
User decides.
Actions close.
Ledger records.
```
