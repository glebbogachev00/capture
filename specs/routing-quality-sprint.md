# Capture routing-quality track

Status: isolated investigation and implementation track
Branch: `feat/routing-quality-sprint`
Baseline: `43aee93a87b93e164ef4733c5e814139e7f50a74`
Owner: Gleb

## Purpose

Raise Thread routing from the owner-accepted recovery baseline toward release-grade reliability without destabilizing the daily local or Cloud versions of Capture.

This work remains isolated until the exact build passes automated real-provider tests, rendered local and Cloud tests, and Gleb's manual acceptance pack. The recovery baseline stays usable throughout.

## Difficulty

Overall complexity: **7/10**.

A narrow prompt tweak could improve a few examples quickly, but that would not establish reliable routing. The hard part is preserving the baseline's strengths while improving multi-subject routing, existing-versus-new decisions, duplicate prevention, and correction generalization on an accumulated board.

## Semantic boundary

The model owns:

- subject detection;
- splitting one capture into several thinking shares;
- deciding whether each share belongs to an existing Thread or a genuinely new Thread;
- semantic generalization from any approved correction context.

Deterministic code may only enforce:

- exact raw preservation and lossless ownership;
- schema and request bounds;
- opaque, authorized destination identities;
- no duplicate settlement, stale writes, or data loss;
- explicit user-selected destinations.

Do not add keyword routing, regex classification, phrase-to-Thread rules, example-specific branches, or post-model semantic rewrites.

## Testable slices

### R1 — Freeze and measure the accepted baseline

- Build a 10–12 case sequential routing pack against one populated synthetic board.
- Include multiple existing Threads, existing plus new, unrelated subjects, repeated paraphrases, and short/long captures.
- Record the exact expected destination set before each run.
- Run both local-first and Cloud-connected paths without changing behavior.

Acceptance: one machine-readable artifact establishes the baseline's passes, failures, latency, and provider provenance.

### R2 — Multiple existing destinations

Fix only the known case where one capture belongs to two or more existing Threads and one destination is omitted.

Acceptance:

- every expected existing destination appears exactly once;
- no unnecessary new Thread is created;
- the baseline's successful Capture/Ovid/Rest-day split still passes;
- Actions and Intentions remain unchanged;
- local and Cloud paths produce the same semantic result.

### R3 — Existing plus genuinely new destination

Support a capture containing one known subject and one genuinely new durable subject.

Acceptance:

- the known share reuses its exact Thread;
- only the genuinely new share creates a Thread;
- paraphrases do not create duplicate Threads;
- retries and reload do not duplicate either destination.

### R4 — Correction generalization and duplicate resistance

Corrections may be shown to the model as bounded semantic examples, never executable phrase rules.

Acceptance:

- a corrected example and unseen paraphrases route to the intended Thread;
- surface word overlap with an unrelated Thread does not redirect the capture;
- no serialized `phrase -> Thread` rule exists;
- disabling/removing a correction removes its influence;
- repeated captures do not mint duplicate Threads.

### R5 — Integrated routing qualification

Run the same 10–12 sequential cases three complete times on the exact candidate build and populated board.

Release bar:

- all expected destinations present;
- no lost subject;
- no unnecessary Thread;
- no duplicate Thread or duplicate settlement;
- raw capture and Record remain exact;
- persistence and reload pass;
- local and Cloud both pass;
- no regression in Unsorted, images, Actions, Intentions, Undo, or Recall surfaces;
- Gleb approves the exact Preview after automated and rendered verification.

## Working discipline

- One slice, one identified Preview, one bounded test list.
- Stop after a rejected slice; fix that boundary before starting another.
- Do not merge this branch into `main` until the complete qualification gate passes.
- Do not copy the rejected semantic overhaul wholesale.
- Keep the recovery deployment as the daily local and Cloud version during all work.
- Treat the recovery behavior as the protected contract: R1 records it, and later slices may only add the named capability while retaining every accepted result.

## Launch boundary

The launch target is a dependable **8/10**, not theoretical perfection. Routing work may ship once the release-critical pack is repeatable, ordinary captures are preserved, and the exact Preview passes owner acceptance. Remaining refinements can continue after launch on isolated branches.

Before launch, add one separate, approval-gated onboarding slice for playground visitors. The existing top-level surface should clearly present two paths—continue locally or sign in for the synced Capture service—without blocking local use, adding a new screen, or changing approved public wording before Gleb reviews the exact copy. This is launch work, not part of R1–R5 routing semantics.
