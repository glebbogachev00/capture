# Local LFM operating plan

## Purpose

Use the local LFM2.5 model as a cheap local worker.

Do not use it as the main brain.

The model is useful when the task is private, repetitive, low-stakes, or too wasteful for GPT, Claude, Gemini, or paid APIs.

## Current setup

Model: `LiquidAI/LFM2.5-2.6B-GGUF:Q4_K_M`

Local endpoint: `http://127.0.0.1:8081/v1`

Start command:

```bash
llama-server -hf LiquidAI/LFM2.5-2.6B-GGUF:Q4_K_M \
  --jinja \
  --reasoning off \
  --reasoning-budget 0 \
  --port 8081 \
  -c 32768 \
  -fa on \
  -ngl 99 \
  --temp 0.1 \
  --top-k 50 \
  --repeat-penalty 1.1
```

Stop command:

```bash
pkill -f "llama-server.*LFM2.5"
```

## Use it when

### 1. The input is private

Use LFM before a cloud model when the source text has personal, finance, business, or raw journal content.

Good tasks:

- Clean a private ramble.
- Extract actions from a private note.
- Summarize a private file.
- Remove sensitive details before a stronger model sees it.

Rule:

```text
Raw private text -> LFM summary -> stronger model only if needed
```

### 2. The task is repetitive

Use LFM when the work is many small passes over local files.

Good tasks:

- Generate rough titles for notes.
- Extract TODOs from markdown files.
- Find stale open loops.
- Group notes by theme.
- Make first-pass summaries.

Rule:

```text
If the task is boring and repeated, try LFM first.
```

### 3. The task is a filter

Use LFM to reduce a pile before GPT or Claude sees it.

Good tasks:

- Keep / discard / needs review.
- Action / thread / intention candidate.
- Worth Claude / not worth Claude.
- Relevant / irrelevant source.
- Duplicate / new signal.

Rule:

```text
LFM filters. Claude or GPT decides.
```

### 4. The task can tolerate imperfect output

Use LFM when bad output costs little.

Good tasks:

- Rough bullets.
- Draft labels.
- First-pass clusters.
- Messy summaries.
- Alternate phrasings.

Rule:

```text
If wrong output is cheap to ignore, LFM is acceptable.
```

### 5. The machine is offline

Use LFM when there is no internet or when providers are down.

Good tasks:

- Local text cleanup.
- Local summarization.
- Rough planning.
- File triage.

Rule:

```text
Offline means LFM first, not no model.
```

## Do not use it when

### 1. The task needs high judgment

Use Claude, GPT, Gemini, or Hermes main models for:

- Strategy.
- Business decisions.
- Product architecture.
- Legal or finance interpretation.
- Final positioning.
- Final copy.

### 2. The task needs strict structured output

Current tests showed weak JSON reliability.

Problems observed:

- Empty final content when reasoning used the token budget.
- Hallucinated tool-call syntax.
- Invalid JSON.

Do not plug it into Capture's main model fallback yet.

### 3. The task is serious coding

Do not use LFM for implementation work unless it is a toy experiment.

Use Claude Code, Codex, or the main Hermes model instead.

### 4. The task needs source-backed truth

Do not use LFM as a research authority.

It has no live web access by itself.

Use Hermes web tools or stronger models for source-backed research.

## Default routing rule

Use this routing rule:

```text
Private + repetitive + low-stakes -> LFM
Important + final + high-judgment -> Claude/GPT/Gemini/Hermes main
Messy pile -> LFM first, stronger model second
Structured production output -> stronger model only
```

## Best immediate workflows

### Workflow A: Local pile reducer

Input:

- A note file.
- A folder of markdown files.
- A research pack.
- A pasted ramble.

Ask LFM:

```text
Return:
1. Keep
2. Actions
3. Discard
4. Needs stronger model
5. One-line summary
```

Use the output as a filter, not as the final answer.

### Workflow B: Private pre-summary

Input:

- Private or sensitive text.

Ask LFM:

```text
Summarize this without names, amounts, addresses, or private details.
Keep only the decision-relevant structure.
```

Send the sanitized summary to a stronger model only if needed.

### Workflow C: Folder janitor

Input:

- A folder of local notes.

Ask LFM per file:

```text
Title:
Main point:
Actions:
Open loops:
Keep or archive:
```

Then review the short results manually.

### Workflow D: Capture eval only

Use LFM against a fixed test set before adding it to Capture.

Pass criteria:

- Valid parse rate at least 90%.
- Correct kind at least 80%.
- No tool-call garbage.
- Median latency under 3 seconds for short inputs.

Until it passes, keep it out of Capture's production model tree.

## Prompt templates

### Pile reducer

```text
You are a local pile reducer.
Do not write polished copy.
Read the text and return only:

1. KEEP: useful signals
2. ACTIONS: concrete next actions
3. DISCARD: distractions
4. NEEDS STRONGER MODEL: tasks for Claude/GPT
5. ONE-LINE SUMMARY

Text:
[PASTE TEXT]
```

### Private sanitizer

```text
Summarize this private text for a stronger model.
Remove names, amounts, addresses, credentials, and private identifiers.
Keep only decisions, constraints, and open questions.

Text:
[PASTE TEXT]
```

### Local note janitor

```text
Read this note and return:

Title:
Main point:
Actions:
Open loops:
Keep / archive:
Why:

Note:
[PASTE NOTE]
```

## Operating decision

Keep the model installed.

Do not leave the server running unless a local task needs it.

Do not add it to Capture yet.

Use it as a local worker for pile reduction, private cleanup, and cheap first-pass triage.
