# Planned routing P1 handoff

Status: internally verified source slice; no production client activation

## P1 implemented

- `src/lib/plannedRouting.ts` defines the model-owned atomic plan for Actions, developing thoughts, Intentions, supporting context, and deadlines.
- Every plan is bound to a caller-assigned `captureId` and must cover the exact source in order.
- Thinking may route to several existing Threads or one proposed new Thread.
- Pure validation checks source coverage, authorized destination identities, duplicate destinations and exact-name collisions, Action identity against the recovery result, model-declared existing-Action duplicates, deadline ownership/ISO structure, unresolved ambiguity, and preservation of the recovery router's kind boundary.
- Invalid or malformed plans receive one retry with categorical validation failures. A second failure returns the existing generic sort failure; no validator/provider payload is exposed.
- `/api/sort` exposes the seam only for explicit `routingPlanVersion: 1` evaluation requests carrying a preassigned `captureId` and existing Action inventory. The normal client does not send that version, so accepted local/Cloud UI and persistence behavior remain unchanged.
- R4 full-capture correction examples and every bounded Thread brief are supplied to the planner. No lexical routing rule or example-specific redirect was added.
- The checked-in accumulated-board pack now has exactly 12 synthetic exercises with required/forbidden Thread IDs, new Threads, expected Actions, structured deadlines, and forbidden duplicates. The malformed-provider exercise is intentionally marked fixture-only so a live semantic run cannot misreport it as passed.

## Do not activate before P2/P3

The P1 response adapter is a read-only evaluation preview. It is **not** an authorized board transaction. Do not make `useBoard` send `routingPlanVersion: 1` until later sprints add these gates:

1. Persist the exact capture and attachments as pending under the same `captureId` before inference.
2. At commit time, atomically prove that `captureId` is still pending and has not settled before.
3. Let manual settlement permanently defeat delayed automatic results.
4. Apply per-Action deadlines, model-declared duplicates, multi-destination thinking, and unresolved spans from the validated plan exactly once.
5. Preserve Record, Undo, images, reload, sync, and local/Cloud ownership semantics.

## Known P1 limits, deferred by design

- `compileRoutingPlan` only renders a legacy-shaped preview for route/evaluation compatibility. Duplicate-only and all-unresolved plans therefore have no safe legacy settlement meaning; it must not become the P2 settlement API.
- The planner preserves the recovery router's kind and exact Action set. This protects accepted behavior in P1, but it also means P1 cannot recover an Action or Intention the recovery interpretation omitted. Mixed Intention-plus-other-item plans are rejected until the settlement model can represent them.
- Paraphrased Thread/Action duplicate meaning is still a model-owned declaration; deterministic validation verifies only supplied IDs, exact-name collisions, and no duplicate settlement references. The live pack remains the semantic qualification gate.
- No pending-state read, revision check, idempotency key, or manual-authority transition exists yet. The route therefore cannot safely commit delayed results.
- Partial unresolved persistence, duplicate-only settlement, mixed Intention-plus-other-item settlement, and per-Action deadline writes belong to P2.
- Durable intake before AI and background execution belong to P3.
- Manual sorting controls and plain, non-generated Intention filing belong to P4.
- Reload retry, images, offline behavior, and sync belong to P5.
- Image requests deliberately stay on the protected recovery path in P1.
- The 12-case harness records sanitized synthetic request context and final observations, but not raw provider diagnostics. Private plan/validator trace persistence needs a non-user-facing evaluation sink before live qualification.
- The malformed-provider route is proven by `src/lib/plannedRoutingRoute.test.ts`, and unchanged client fallback persistence by `src/hooks/useBoard.voiceSource.test.ts`; the live runner still reports `SOURCE_FIXTURE_REQUIRED` instead of fabricating a provider pass.

## Qualification boundary

No live provider was authorized or run. Do not claim a semantic score or 10/10. P6 still requires the complete accumulated sequence across three primary-model rounds and one forced-fallback round, plus the six safety-layer exercises and owner acceptance.
