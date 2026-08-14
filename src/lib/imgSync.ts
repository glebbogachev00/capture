import { parseCover } from "./cover";
import type { Board } from "./model";

/**
 * Which images the board actually refers to.
 *
 * Photo bytes never ride inside the board — they live under their own
 * IndexedDB keys, and the board carries only ids. That is what keeps the
 * synced payload text-only, and it is also why a photo used to stop at the
 * device that took it: the other device received a fragment pointing at an
 * id whose bytes it had never seen. Reconciling those ids against the hub is
 * what closes the gap, and this is the list to reconcile.
 *
 * Ids are immutable — generated once at capture and never rewritten — so an
 * image is content the two sides can exchange without any conflict rules.
 */
export function referencedImageIds(board: Board): string[] {
  const ids = new Set<string>();
  for (const a of board.actions) for (const id of a.imgs || []) ids.add(id);
  for (const t of board.threads) {
    for (const f of t.frags || []) for (const id of f.imgs || []) ids.add(id);
    /* A photo cover is a reference like any other, and the only one that
       hangs off no fragment — it is picked straight from the file input and
       stored under a fresh id. Leaving it out of this list is why a cover
       set on the phone arrived on the laptop as an id with no bytes behind
       it: the board carried the reference, the reconcile never carried the
       photo. */
    const cover = parseCover(t.cover);
    if (cover?.kind === "img") ids.add(cover.id);
  }
  return [...ids];
}

/** An id safe to use as a file name on the hub: the app's own uid alphabet,
    nothing that could climb out of the directory. */
export function isSafeImageId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/.test(id);
}
