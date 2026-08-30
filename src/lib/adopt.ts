import { arrivedIn, arrivedNote } from "./arrived";
import type { Board } from "./model";
import {
  boardSignature,
  mergeSync,
  type SyncState,
  type Tombstone,
} from "./sync";

/**
 * Adopting the hub's copy — the one decision both halves of sync share.
 *
 * A push and a pull end the same way: the hub hands back a merged state,
 * and this device has to decide what its board now is. That decision was
 * written out twice inside the hook, interleaved with fetches and React,
 * and it is where sync's subtlest rules live:
 *
 *   - The reply is merged against the board AS IT IS NOW, not as it was
 *     when the request left. A capture made while the request was in
 *     flight is newer than anything in the reply, and newest-wins per item
 *     keeps it. Adopting the reply wholesale would let a 1.2-second round
 *     trip eat a capture.
 *
 *   - "Changed" is judged item-by-item, by signature over the whole state.
 *     The cheaper test — "is the newest incoming thing newer than mine?" —
 *     shipped once and silently dropped real edits whenever this device
 *     held anything fresher than the incoming change.
 *
 *   - The note reports ADDITIONS only. An edit shows itself where it
 *     happened; three notes arriving from the other device is the thing
 *     worth a sentence.
 */

export type Adoption = {
  board: Board;
  tombstones: Tombstone[];
  /** Did adopting actually change this device's state? */
  changed: boolean;
  /** What to tell the person, when additions arrived — null otherwise. */
  note: string | null;
};

export function adoptHubState(local: SyncState, remote: SyncState): Adoption {
  const merged = mergeSync(local, remote);
  const changed =
    boardSignature(merged.board, merged.tombstones) !==
    boardSignature(local.board, local.tombstones ?? []);
  const note = changed
    ? arrivedNote(arrivedIn(local.board, merged.board))
    : null;
  return {
    board: merged.board,
    tombstones: merged.tombstones,
    changed,
    note,
  };
}
