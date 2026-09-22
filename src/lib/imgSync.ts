import { ownedFetch } from "./ownership";
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
export function allReferencedImageIds(board: Board): unknown[] {
  const ids = new Set<unknown>();
  for (const a of board.actions) for (const id of a.imgs || []) ids.add(id);
  for (const intention of board.intentions) {
    for (const id of intention.imgs ?? []) ids.add(id);
  }
  for (const entry of board.ledger ?? []) {
    if (entry.kind === "pending" && entry.undone) continue;
    for (const id of entry.imgs ?? []) ids.add(id);
  }
  for (const t of board.threads) {
    for (const f of t.frags || []) for (const id of f.imgs || []) ids.add(id);
    /* Read the raw reference here. Strict backup validation must see malformed
       `img:` ids rather than letting the display parser silently discard them. */
    if (typeof t.cover === "string" && t.cover.startsWith("img:")) {
      ids.add(t.cover.slice(4));
    }
  }
  if (board.profile?.imageId !== undefined) ids.add(board.profile.imageId);
  return [...ids];
}

export function referencedImageIds(board: Board): string[] {
  return allReferencedImageIds(board).filter(
    (id): id is string => typeof id === "string" && isSafeImageId(id)
  );
}

/** An id safe to use as a file name on the hub: the app's own uid alphabet,
    nothing that could climb out of the directory. */
export function isSafeImageId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/.test(id);
}

type ImageRequest = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

/**
 * Confirm that the hub holds an image. Ask with no body first, then send the
 * bytes only when the hub says that exact id is missing.
 */
export async function ensureHubImage(
  id: string,
  src: string,
  request: ImageRequest = ownedFetch
): Promise<boolean> {
  if (!isSafeImageId(id)) return false;
  const existing = await request(`/api/img/${id}`, { method: "HEAD" });
  if (existing.ok) return true;
  if (existing.status !== 404) return false;

  const uploaded = await request(`/api/img/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ src }),
  });
  return uploaded.ok;
}
