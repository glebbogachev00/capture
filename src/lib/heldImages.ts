/**
 * Pictures belonging to a deletion the user can still take back.
 *
 * `dropImages` destroys the bytes in IndexedDB. Anything the app deletes
 * while offering an Undo therefore cannot drop its pictures at the moment
 * of the delete — the undo would restore an action or a note pointing at a
 * photo that no longer exists, which is worse than the deletion it was
 * meant to reverse.
 *
 * So the ids wait here. They become really deletable only when the snapshot
 * that could have restored them is replaced by a newer one — at that point
 * nothing can bring them back and the bytes are no longer worth keeping.
 * An undo that actually runs cancels the queue outright.
 *
 * Deliberately not a React ref with the logic inline: this is the rule that
 * says when a picture is safe to destroy, and it belongs somewhere it can
 * be read and tested on its own.
 */

export type HeldImages = {
  /** Keep these alive: something Undo can restore still points at them. */
  hold: (ids: string[] | undefined) => void;
  /**
   * The undo that was protecting them is gone. Returns the ids that are now
   * safe to destroy and empties the queue.
   */
  release: () => string[];
  /** The undo ran — the board wants these back, so nothing is destroyed. */
  cancel: () => void;
  /** What is currently being protected. For tests and assertions. */
  held: () => string[];
};

export function createHeldImages(): HeldImages {
  let ids: string[] = [];
  return {
    hold(more) {
      if (more?.length) ids = [...ids, ...more];
    },
    release() {
      const stale = ids;
      ids = [];
      return stale;
    },
    cancel() {
      ids = [];
    },
    held() {
      return ids;
    },
  };
}
