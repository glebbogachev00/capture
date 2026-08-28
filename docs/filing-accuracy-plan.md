# Filing accuracy — the plan

Capture's selling point is that it puts things where they belong. Measured
against Gleb's own board on 2026-08-28, it gets that wrong **one time in
five**: of 103 captures whose fragment can still be traced, 21 were moved by
hand afterwards. The target is **under 10%, ideally 5%**.

Everything below is ordered so that each phase can be proved before the next
one starts. The rule for the whole plan: **no change to filing ships without
a before-and-after number.** "Improved" has been an opinion for weeks; that
is the actual defect being fixed here.

## Phase 1 — Measure

Establish the baseline nothing has ever had.

- `scripts/eval-sort.mjs` replays real captures through `/api/sort` and scores
  the chosen thread against where the fragment lives today. Ground truth is
  the person's own correction, not a hand-written label.
- Deliverable: baseline accuracy, the confusion table, and every miss listed.

Done when: a number exists and can be reproduced with one command.

## Phase 2 — Give the sorter something to discriminate on

The dominant confusion is `Capture.` → `Bugs, Issues and Additions`: 7 of the
21 corrections. Both threads are described to the sorter by their summaries,
and both summaries are *about Capture*. Worse, each summary is written with
no knowledge that the other thread exists — routing is a comparison, but
every description is an autobiography.

- Each thread gains a short **"what belongs here"** line, generated in the
  same summariser call, with the sibling thread names in view so it can draw
  boundaries the summary structurally cannot.
- The summary keeps its job: what this thread currently is, for reading.
- Existing threads backfill as summaries refresh, or in one pass.
- Check it survives hydrate, sync, backup and Undo — adding a field has now
  broken two of those four, so `boardFields.test.ts` covers it.

Done when: the eval is re-run and the number moves, or the idea is discarded.

## Phase 3 — Make the learning loop learn something

118 corrections are recorded and 9 are refiles — the engine was wrong and
Gleb fixed it. The rules derived from them are keyed on arbitrary word pairs:

    Captures about "items kind" belong in "Bugs, Issues and Additions"
    Captures about "figure products" belong in "Reducing friction strategy"
    Captures about "bugs issues" belong in "Bugs, Issues and Additions"

These are noise, they cannot express the distinction that matters, and they
consume all five rule slots sent with every sort.

- A refile should sharpen the two threads' boundary lines instead — the place
  where "something broken goes to Bugs, even when it is about Capture" can
  actually be said.
- Keep the rules mechanism only for what it is good at (kind, not thread).

Done when: the eval is re-run, and specifically when the previously-corrected
cases stop failing.

## Phase 4 — A regression suite that catches what unit tests cannot

Recorded browser flows, with a clean board between each, covering the surfaces
a person touches. These do not measure filing accuracy — nothing visible in a
frame says a note went to the wrong thread — they catch visual and
interaction regressions, which is a different job and also needed.

Target: 20–30 flows across capture kinds, split, undo, tidy, the wrap, the
record, images, search, threads, intentions, settings, and 390px mobile.

## Phase 5 — Finish the trust work

- A behaviour-level regression test for Distill fragment attribution.
- Split the working tree into separate commits: source and tests, agent-system
  docs, social material. Generated PNGs do not enter a source commit.
- The privacy contract: the wrap posts a day's capture text automatically
  while the README says model use happens when you ask for sorting. That is
  Gleb's decision — opt-in, a setting, local-only, or an honest README — and
  it blocks nothing else.
