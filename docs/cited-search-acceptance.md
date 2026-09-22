# Cited Search: local acceptance

## Behavior

Search keeps its existing keyword results and updates them immediately. After a likely question remains stable for 600 ms,
Capture automatically prepares one answer from matching saved notes. There is no answer button or Enter requirement.
The feature does not add a chat history, modify a capture, or save the generated answer.

Retrieval runs locally after the debounce. It selects at most 12 excerpts, each limited to 1,500 characters.
Thread names help locate notes. Generated summaries do not provide evidence.
The request excludes images, profile data, principles, and the full Record ledger.

The network task starts only while online ownership checks remain valid. Search stays visually quiet while the answer is
prepared; it does not insert a loading card, provider explanation, or evidence inspector.
The model receives the question and those excerpts through the existing provider chain.
Each claim must include a source ID and a verbatim supporting quote.
The interface renders only the verified answer and one compact control for each connected Thread or Intention. Thread
controls open the cited fragment; Intention controls open the cited intention. Submitted quotes remain a validation
boundary rather than additional UI.

## Boundaries

- Only the precision-first question detector can start automatic answering. Ordinary searches, quoted questions, filenames,
  incomplete prompts, and unsupported punctuation remain local-only.
- A normalized question plus its exact bounded source snapshot identifies a request. A successful request is deduplicated
  across board identity changes, sync, offline/online transitions, same-owner revalidation, and connected-item navigation.
  Returning from a connected Thread or Intention restores the document-session cached verified answer without retransmission.
- A transmitted failure gets no automatic retry in the same query visit. Deliberately changing the query away and back, or
  changing the bounded source snapshot, permits one new attempt. No retry button is added.
- The server limits the complete request to 96 KiB and the operation to 45 seconds.
- Individual provider attempts have a 10-second limit and no SDK retries.
- Cloud requests require verified identity and the matching owner precondition.
- Anonymous Cloud sessions and the public playground cannot use this feature.
- Offline and revoked sessions cannot disclose notes through this feature.
- Responses use `private, no-store`. The feature does not persist or log note content.
- HTTP, transport, timeout, and invalid-answer failures remain distinct from insufficient evidence. Local results and saved
  notes remain unchanged in every case.

## Limits of the evidence

Retrieval ranks words and topic labels. It is not embedding-based semantic search and can miss synonyms.
The submitted excerpts are a matching subset, not the complete board or its history.
The feature does not search removed captures or completion receipts that exist only in the Record.
Long notes can lose relevant context outside the selected excerpt.

Quote validation checks source identity and exact wording. It does not prove that a model's interpretation follows from the quote.
The prompt requires uncertainty and both sides of a disagreement. Newer speculation must not replace an older decision without evidence.
Real-provider compliance with those instructions remains unverified.

## Verification status

- The final minimal-surface component and Capture integration run passed 48 tests. The broader focused Search-that-answers
  regression suite remains covered by the integrated full gate.
- Detector regressions cover the five reported ordinary searches, exact multilingual tokens/phrases, ASCII and fullwidth
  question marks, Greek and Arabic question marks, and non-question ASCII/fullwidth semicolons.
- Component regressions cover HTTP, transport, 45-second timeout, and invalid-answer failures. Each proves no immediate
  retry, then a retry after changing the query away and back; a changed bounded source snapshot has separate coverage.
- Existing integration coverage proves immediate local results, a visually quiet wait, minimal answer rendering,
  stale-request retirement, unchanged storage, exact cited-fragment navigation, and successful-request deduplication
  through board/readiness churn.
- The final integrated full serialized suite passed 1,884 tests across 195 files.
- TypeScript and canonical lint passed.
- The isolated Next.js production build passed. Its trace guard checked 45 manifests and found no private paths.
- `git diff --check` passed. No live request, deployment, service mutation, environment-file read, commit, merge, or push was performed.

A fresh Retake desktop acceptance run passed all 11 steps and its artifact check at 960×720, 24 fps, and 7.0 seconds.
Rendered inspection confirmed that ordinary Search has no answer surface; a stable question adds only the Answer label,
verified answer text, and one connected Thread control above unchanged local results; and that control opens the native
cited Thread without clipping, overlap, or squeeze. The answer request and response were deterministic synthetic fixtures,
not a live provider or deployed-preview test.

Fixtures contain synthetic notes and synthetic model answers. They do not demonstrate live model accuracy, account isolation on a deployment, or physical-device behavior.
No personal backup, production data, billing state, provider configuration, or account was changed.

## Release and usefulness gates

This work is local, not a deployment or launch signoff.
Run an approved real-question pilot before claiming that answers reliably save reading.
The pilot must check usefulness, citation accuracy, unsupported claims, latency, and context size.
Any real-question pilot using personal sources requires owner approval before that pilot. The product itself has no per-query confirmation click.

Cloud billing, deployed account isolation, image publication, physical-device recovery, and the agreed Cloud trial remain separate launch gates.
Natural-language multi-thread filing remains a separate, unimplemented task.
