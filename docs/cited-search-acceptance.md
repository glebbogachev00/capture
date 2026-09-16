# Cited Search: local acceptance

## Behavior

Search keeps its existing keyword results. **Answer from my captures** requests one answer from matching saved notes.
The feature does not add a chat history, modify a capture, or save the generated answer.

Retrieval runs locally after the button click. It selects at most 12 excerpts, each limited to 1,500 characters.
Thread names help locate notes. Generated summaries do not provide evidence.
The request excludes images, profile data, principles, and the full Record ledger.

The model receives the question and those excerpts through the existing provider chain.
Each claim must include a source ID and a verbatim supporting quote.
The interface shows the source date and state. Thread links open the cited fragment.
Intention links open the cited intention. Actions expose their submitted source text.

## Boundaries

- Only an explicit click requests an answer. Typing does not make model calls.
- The server limits the complete request to 96 KiB and the operation to 45 seconds.
- Individual provider attempts have a 10-second limit and no SDK retries.
- Cloud requests require verified identity and the matching owner precondition.
- Anonymous Cloud sessions and the public playground cannot use this feature.
- Offline and revoked sessions cannot disclose notes through this feature.
- Responses use `private, no-store`. The feature does not persist or log note content.
- Failure is distinct from insufficient evidence. Neither state changes the saved notes.

## Limits of the evidence

Retrieval ranks words and topic labels. It is not embedding-based semantic search and can miss synonyms.
The submitted excerpts are a matching subset, not the complete board or its history.
The feature does not search removed captures or completion receipts that exist only in the Record.
Long notes can lose relevant context outside the selected excerpt.

Quote validation checks source identity and exact wording. It does not prove that a model's interpretation follows from the quote.
The prompt requires uncertainty and both sides of a disagreement. Newer speculation must not replace an older decision without evidence.
Real-provider compliance with those instructions remains unverified.

## Verification status

- The final focused run passed 116 tests across retrieval, endpoint, component, and Capture integration files.
- Real Capture integration preserved the stored board and opened the exact cited fragment.
- Editing the search query suppressed a delayed answer, including a transport that ignored cancellation.
- Endpoint checks passed: 58 tests for input limits, timeouts, cancellation, ownership, unavailable providers, and private responses.
- The corrected `CopyPrompt` suite passed all 15 tests. No landing-page source changed.
- Independent review found no blocking issue. Quote validation does not establish semantic accuracy.
- Chromium and WebKit passed at 1440px and 390px, against both development and locally built production assets.
- Browser checks covered explicit requests, bounded originals, dates, source navigation, unchanged storage, and no persisted answers.
- They also covered insufficient evidence, forged citations, stale requests, empty retrieval, and the real local route without providers.
- Screenshots showed readable desktop/mobile citations. Each browser run reported no horizontal overflow and no page errors.
- TypeScript and canonical lint passed. Lint retains one existing unused `Frag` warning in `src/lib/fragOps.ts`.
- The isolated build passed. Its trace guard checked 46 manifests and found no private paths.
- The first final full suite passed 1,651 tests but failed two hydration waits in `Capture.recall.test.tsx`.
- Those tests now wait for the loaded board before checking thread counts. Three focused repetitions passed without longer timeouts.
- The full-suite rerun passed all 1,653 tests across 185 files.
- Application source still matches the browser-tested build. Only test readiness assertions changed afterward.

Local browser artifacts: `/tmp/capture-recall-build-evidence` and `/tmp/capture-recall-evidence`.
The harness is `/tmp/capture-recall-browser.cjs`. These temporary artifacts do not certify another deployment.

Fixtures contain synthetic notes and synthetic model answers. They do not demonstrate live model accuracy, account isolation on a deployment, or physical-device behavior.
No personal backup, production data, billing state, provider configuration, or account was changed.

## Release and usefulness gates

This work is local, not a deployment or launch signoff.
Run an approved real-question pilot before claiming that answers reliably save reading.
The pilot must check usefulness, citation accuracy, unsupported claims, latency, and context size.
Personal sources require explicit approval before transmission.

Cloud billing, deployed account isolation, image publication, physical-device recovery, and the agreed Cloud trial remain separate launch gates.
Natural-language multi-thread filing remains a separate, unimplemented task.
