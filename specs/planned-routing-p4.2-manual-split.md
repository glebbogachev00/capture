# P4.2 manual split contract

Status: two independent-review identity/idempotency blockers repaired and source-verified; ready for another independent read-only review, not owner testing

## Smallest safe interaction

`Split manually` is a separate secondary control on an Unsorted card. The ordinary Action, Intention, Thread, Later, Edit, Delete, and Sort now controls keep their current behavior and click count.

Opening the control creates a local draft only. It starts with one text segment containing the pending source byte-for-byte and destination `Pending`. Capture does not infer a boundary, call a model, split on punctuation, or rewrite text.

Inside the editor the person may:

- add an empty segment;
- edit segment text;
- move a segment up or down to choose filing order;
- remove a segment;
- choose `Pending`, `Action`, `Intention`, `Existing thread`, or `New thread` for every non-empty segment;
- choose an existing Thread when that destination is selected;
- cancel, which closes the draft without any Board, ledger, tombstone, image, or authority change;
- save only when the mechanical contract below is valid.

The editor identifies each segment by its original source-order key separately from its visible filing order. Reordering therefore changes only the order in which the explicit results are presented/applied; it cannot change source coverage. Adding a segment inserts a new source-order key next to the selected segment. Editing can move an exact boundary between source-order neighbors. Removing text or inventing text makes the draft invalid until the exact source is restored elsewhere.

## Mechanical validity contract

A split is valid only when all of these are true:

1. There are at least two non-empty segments.
2. Segment IDs and source-order keys are unique.
3. Concatenating segment text by source-order key is byte-for-byte equal to the exact pending source. No trim, Unicode normalization, delimiter insertion, punctuation rule, or lexical interpretation is allowed.
4. Every segment has one explicit destination. An existing-Thread destination names a currently existing Thread.
5. The editor-open snapshot carries the pending-row id, capture id, target id,
   exact source, exact ordered image ids, input source, and revision. Exactly one
   active pending row may target that envelope at commit time, and every snapshot
   field must still match both the row and envelope. Changed or reordered
   attachments, a replaced row or capture identity, a stale target/source/
   revision, or zero/multiple target rows is `pending_mismatch` and writes
   nothing.

Invalid drafts write nothing. The UI explains only the actionable coverage or destination issue, not internal schema language.

## Settlement and provenance

One pure transition creates every requested artifact and every replacement pending envelope, retires the exact original pending ledger row, and preserves the immutable capture identity. Every new ledger row carries the original `captureId`, timestamp, raw source, input source, transcript where applicable, and the segment's exact text. Results use deterministic IDs derived from capture id, original pending-row id, revision, and segment id, so retry/reload/sync cannot mint duplicates.

- `Action`: original segment wording, default `keep` shelf, no generated guidance.
- `Intention`: original segment wording, no generated actions or counter-intentions.
- `Existing thread`: one exact fragment in the selected Thread.
- `New thread`: one exact fragment in a clearly temporary mechanically titled Thread.
- `Pending`: one Unsorted envelope at the next pending revision.

The complete Board plus tombstones is persisted through the existing single durable transaction lane and adopted only after IndexedDB commits. Any stale revision/destination, identity collision, storage failure, or competing finalization causes no Board change and leaves the editor open for retry.

A capture-level manual authority claim is acquired before the durable transaction. It aborts/defeats delayed AI until released. Once automatic finalization already owns the capture, split saving is refused rather than racing or falsely acknowledging success.

The authority claim uses the capture id from that same immutable editor
snapshot; the operation rejects a shown-card/target mismatch before claiming.
The durable transition settles only that snapshotted row. If the capture already
has an active classified settlement, the row is admissible only when that exact
row is explicitly `partial`. This preserves discontiguous unresolved remainders:
one selected partial row may settle while sibling partial rows and earlier
automatic outputs remain untouched. A stale non-partial row cannot create a
second settlement.

## Attachment ownership

P4.2 does not guess which text segment owns an attachment and does not provide an attachment-assignment control.

All image IDs and bytes remain, in original order and exactly once, on the original pending envelope. After a successful text split, that envelope becomes an image-only Unsorted envelope at the next revision; its original action id, capture id, timestamp, image IDs, and provenance remain traceable. No split text artifact receives an image reference. If the capture has no images, the original envelope is retired with its ordinary tombstone.

This deliberately leaves attachment assignment for a later explicit product interaction. It is safe with the current model because no byte or reference is duplicated, dropped, or silently attributed. Existing manual filing/deletion of the image-only pending envelope remains available.

## Required proof

- pure losslessness tests, including whitespace, repeated text, reordered filing,
  edited boundaries, removal, stale revisions/destinations, collisions, retry,
  and idempotency;
- exact-snapshot regressions for changed and reordered attachments, replaced
  capture and pending-row identities, duplicate active rows targeting one
  envelope, and stale editor state;
- second-settlement regressions for a classified capture plus stale non-partial
  row, replay, duplicate target, and two discontiguous partial rows;
- image tests proving the original envelope alone owns every image before/after reload, sync, retry, cancellation, and partial filing;
- hook tests proving one durable write, storage-failure no-op, delayed-AI defeat, and reload equivalence;
- rendered accessible tests for open/add/edit/reorder/remove/destination selection/thread selection/validation/cancel/save, with ordinary controls unchanged.
