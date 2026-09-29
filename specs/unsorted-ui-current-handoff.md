# Unsorted UI reconciliation — local, not approved

Target: /Users/glebbogachev/Documents/Capture-planned-routing, feat/planned-routing-validation. Preserve the entire intentionally dirty worktree. No commit, deployment, provider/service access, reset, stash, clean, or integration was performed.

## Implemented in this run
- Read AGENTS.md, capture-dev, capture-product-interface, current source/tests/CSS, and all six owner screenshots.
- Added shared RecoveryDisclosure: Faded follows the new Unsorted plus/minus visual pattern without replacing its content or recovery behavior.
- Normalized Unsorted More to lucide; added Escape/outside dismissal and focus return; full-row 44px secondary menu controls and menu-scale styling, including delete confirmation.
- Removed abandoned inline-picker CSS. Preserved intrinsic stacked cards and 18px action gap. Expanded mobile sheet breakpoint to 640px.
- Picker background inert/scroll lock; callback updates no longer reset focus; header/search do not shrink; result rows wrap and have hover/focus states.
- Extracted CaptureReceipt and useDestinationPicker to keep screen orchestration within its existing ratchet. Neutral pending receipt specificity corrected; Undo has a 44px target.
- Extracted useManualFiling to own manual receipt/Undo seam within the existing hook ratchet.
- Manual inverse snapshots exact final stamped state in the same durable transaction via deferred companion entries. Reload restores an eligible exact receipt. Storage failure retires stale success and offers Retry Undo; duplicate Undo clicks are gated.
- Manual Undo rejects changed retired provenance and superseding tombstones. Restores the exact capture/action/source/attachment evidence in a new pending ledger slot because retired ledger rows are monotonic under sync. Original retired row remains historical; captureId/action id and pending revision are preserved. This also permits refiling without colliding with the previous settlement id.

## Execution evidence
Final focused set: 8 files / 42 tests passed (Unsorted, CSS, picker, Capture receipt, manual Undo, manual operations, durable commit, ratchets). TypeScript passed.
Touched lint initially found one refs error in useManualFiling and one exhaustive-deps warning in useBoard. Ref access fixed by constructing operation closures on invocation, not during render. After that: Capture integration + ratchets 9/9 passed, TypeScript passed, useManualFiling lint passed, git diff --check passed. The useBoard hydration exhaustive-deps warning for restoreManualReceipt remains unresolved; do not add the unstable callback to dependencies blindly and restart hydration each render.
Red-to-green witnessed: background inert, More dismissal/icon, Faded disclosure, menu CSS/mobile breakpoint, Undo sync retirement/refiling, stale provenance/tombstones, reload receipt, storage-failure receipt, neutral pending CSS.

## Not complete / do not call frozen or visual-review ready
- No final Retake desktop 1440x900/mobile 390x844 runs or screenshots were produced. Retake CLI is installed; localhost /app returned 200 during initial inspection only. Runtime was not finally render-inspected.
- Resolve the remaining hydration dependency warning without replaying hydration; run full touched lint again.
- Finish audit/tests for stale/manual filing refusal feedback and receipt identity under unrelated async outcomes; currently some manualSort conflict exits return false without explanatory UI.
- Audit successful selection focus when its original card/receipt disappears after persistence.
- Naming confirmation still says Create Thread (capital T); align with requested sentence case and update focused expectation.
- Strengthen inverse validation and races: current artifact equality deliberately ignores updatedAt; evaluate edit/revert conflicts with exact stamped snapshots now available. Full sync merge was not run for the inverse, only both-order ledger merge plus durable local integration.
- Broader P1–P5 focused regression families were not rerun. No P6 or broad backend work was done.

## Files edited this run
src/app/Capture.tsx; src/app/globals.css; src/components/UnsortedCaptures.tsx; src/components/UnsortedCaptures.test.tsx; src/components/UnsortedCaptures.css.test.tsx; src/components/DestinationPicker.tsx; src/components/DestinationPicker.test.tsx; src/components/Capture.destinationPicker.test.tsx; src/components/RecoveryDisclosure.tsx (new); src/components/CaptureReceipt.tsx (new); src/hooks/useBoard.ts; src/hooks/useManualFiling.ts (new); src/lib/manualRoutingUndo.ts; src/lib/manualRoutingUndo.test.ts; src/lib/manualRoutingOperations.ts; src/lib/durableBoardCommit.ts. Other dirty files predate this run and were preserved.
