import { IMG } from "./model";
import { del, get, set } from "./storage";

/**
 * Image bytes, memory first.
 *
 * Every picture on the board was rendered straight out of IndexedDB: a
 * component mounted, asked the store, and showed nothing until the answer
 * came back. That round-trip is invisible on a quiet desktop and is exactly
 * what "the images disappear during the sorting and then come back" looks
 * like on a phone: sorting commits write the whole board into the same
 * store the pictures are read from, reads queue behind writes, and any
 * remounted image blanks until the queue drains.
 *
 * So bytes seen once stay in memory, and showing a picture again is
 * synchronous — no store, no queue, no blank. The store remains the truth:
 * memory is only ever a copy of what was read from or written to it, and
 * deleting goes through here so the copy cannot outlive the bytes.
 *
 * Bounded, because photos are a few hundred KB of data URL each and a
 * phone's tab does not get to hold every picture ever taken. Insertion
 * order is eviction order — old boards scroll, the recent screen stays
 * warm. On eviction the bytes are still in the store; the next read just
 * pays the round-trip again.
 */

const mem = new Map<string, string>();

/** ~40 photos × a few hundred KB ≈ tens of MB, the most a tab should carry. */
const CAP = 40;

function remember(id: string, src: string) {
  if (mem.has(id)) mem.delete(id); // re-insert to refresh its place in line
  mem.set(id, src);
  while (mem.size > CAP) {
    const oldest = mem.keys().next().value;
    if (oldest === undefined) break;
    mem.delete(oldest);
  }
}

/** The synchronous peek — what a component can render on its very first
    frame. Null means "not in memory", not "does not exist". */
export function imgNow(id: string): string | null {
  const hit = mem.get(id);
  if (hit) remember(id, hit); // keep what is being looked at warm
  return hit ?? null;
}

/** The full read: memory, then the store, filling memory on the way out. */
export async function imgLoad(id: string): Promise<string | null> {
  const hit = imgNow(id);
  if (hit) return hit;
  const stored = await get(IMG(id));
  if (stored) remember(id, stored);
  return stored ?? null;
}

/** Write bytes — capture, sync arrival — through the cache, so the next
    render is already warm. */
export async function imgSave(id: string, src: string): Promise<void> {
  remember(id, src);
  await set(IMG(id), src);
}

/** Delete bytes. Memory goes first, so a copy can never outlive the store. */
export async function imgDrop(id: string): Promise<void> {
  mem.delete(id);
  try {
    await del(IMG(id));
  } catch {
    /* already gone */
  }
}

/** Test hook. */
export function _clearImgCache(): void {
  mem.clear();
}
