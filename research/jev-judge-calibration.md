# Jev `/api/judge` calibration gate

_Synthetic foundation plus one harmless isolated Preview observation. No
private Capture data or credential values were used._

## Current production decision

Jev does **not** prefilter `/api/judge`, drop candidates, choose reasons, or
skip the existing generative call. `CAPTURE_JEV_JUDGE_SHADOW` is separate from
the thread-rerank flag and defaults off. When explicitly enabled, it runs only
after the full original candidate batch has already been judged.

This is intentional fail-open behavior. A missing answer, malformed envelope,
timeout, privacy-routing refusal, scheduling failure, or any uncalibrated/low-
confidence score leaves every candidate on the existing path.

## Checked-in synthetic benchmark foundation

- `src/lib/fixtures/jevJudgeSynthetic.json` contains invented organizer
  candidates and human-readable expected keep/reject labels. It contains no
  board export or private note text.
- `src/lib/jevJudgeBenchmark.ts` evaluates an externally supplied Noul score
  for every fixture at a hypothetical threshold.
- `src/lib/jevJudgeBenchmark.test.ts` pins the harness behavior with synthetic
  scores. It measures candidate accuracy, false-rejection count/rate, potential
  whole-batch generative-call elimination, and unsafe eliminated batches. It
  also sweeps 0.00–1.00 without selecting a threshold.

The scores in the unit test are test vectors, **not Jev observations** and not
evidence that 0.5 or any other cutoff is safe.

## Exact activation blocker

No threshold can be derived yet because the required calibration inputs remain
insufficient:

1. Only one two-candidate, non-sensitive Preview observation from the pinned
   model exists. It proved transport and score separation, not calibration.
2. The small synthetic fixture set proves the measurement harness, not the
   distribution of future Tidy candidates. It cannot guarantee the costliest
   error—rejecting a suggestion the generative judge should keep.
3. No product owner has approved a maximum false-rejection rate, confidence
   level/sample size, or whether even one observed false rejection is
   acceptable in exchange for generative-call elimination.

Activation requires a separate reviewed change that adds non-private,
representative recorded Jev outputs for the pinned model, declares the accepted
false-rejection bound and confidence requirement before examining thresholds,
uses the harness to derive a cutoff that satisfies that gate, and keeps every
failure/uncertain case fail-open. Until then, actual prefilter activation is
unimplemented.