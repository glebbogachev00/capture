import { type Board, hydrate } from "./model";
import { mergeCorrections, mergeLedgers } from "./ledger";
import { mergeWraps, mergeCompletions } from "./wrap";

/**
 * Getting the whole board out of the device, and back in.
 *
 * Everything lives in one browser's IndexedDB. Clearing site data, replacing
 * the phone, or the OS evicting the PWA all take the lot with them, and until
 * now there was no way to get a copy out. Export is the more important half of
 * this file: import only matters once something has been exported.
 *
 * Images are included since v2. They live per-id outside the board (in
 * IndexedDB under IMG(id)); a v1 backup carried only the ids and a restore
 * silently lost every photo. Shrinking at capture (lib/shrink.ts) keeps the
 * payload in the low single-digit megabytes, which makes carrying the bytes
 * affordable. v1 backups (no images field) still restore — just without the
 * photos.
 */

export const BACKUP_APP = "capture";
export const BACKUP_VERSION = 2;

export type CaptureBackup = {
  app: typeof BACKUP_APP;
  version: number;
  exportedAt: string;
  board: Board;
  /** Image bytes by id, so a restore can bring the photos back. Keyed by the
      ids the board references in Action.imgs / Frag.imgs. */
  images?: Record<string, string>;
};

export function buildBackup(
  board: Board,
  images: Record<string, string> = {}
): CaptureBackup {
  return {
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    board,
    images,
  };
}

export function backupFilename(now = new Date()) {
  return `capture-backup-${now.toISOString().slice(0, 10)}.json`;
}

export function downloadJSON(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Read a file as JSON, failing in words rather than in parser-speak.
 *
 * "Unexpected token 'o' at position 1" tells the person holding the phone
 * nothing about which file to pick instead.
 */
export async function readJsonFile(file: File): Promise<unknown> {
  let text: string;
  try {
    text = await file.text();
  } catch {
    throw new Error("That file couldn't be opened.");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `"${file.name}" isn't readable as JSON. Backups are .json files — check you picked the right one.`
    );
  }
}

export type RestoreResult = {
  board: Board;
  actions: number;
  threads: number;
  intentions: number;
  principles: number;
  /** The backup's image bytes, to be written back into IndexedDB. The caller
      decides which ids the merged board still references; an image whose id
      is not on the board is simply not restored. */
  images?: Record<string, string>;
};

/**
 * Merge a backup into the board rather than replacing it.
 *
 * Matched on id throughout, so restoring onto a device that already has some
 * of this is safe and restoring twice changes nothing the second time. What
 * is already here always wins — a restore can add, never overwrite.
 */
export function restoreBackup(parsed: unknown, board: Board): RestoreResult {
  const backup = parsed as Partial<CaptureBackup>;
  if (!backup || backup.app !== BACKUP_APP || !backup.board) {
    throw new Error(
      "That isn't a capture backup. Use the file this app exported — an intent backup goes in the box below."
    );
  }

  const incoming = hydrate(backup.board);
  const merged = { ...board };
  const counts = { actions: 0, threads: 0, intentions: 0, principles: 0 };
  const images = backup.images || undefined;

  const haveActions = new Set(board.actions.map((a) => a.id));
  const newActions = incoming.actions.filter((a) => a?.id && !haveActions.has(a.id));
  counts.actions = newActions.length;
  merged.actions = [...board.actions, ...newActions];

  const haveThreads = new Set(board.threads.map((t) => t.id));
  const newThreads = incoming.threads.filter((t) => t?.id && !haveThreads.has(t.id));
  counts.threads = newThreads.length;
  merged.threads = [...board.threads, ...newThreads];

  const haveIntentions = new Set(board.intentions.map((i) => i.id));
  const newIntentions = incoming.intentions.filter(
    (i) => i?.id && !haveIntentions.has(i.id)
  );
  counts.intentions = newIntentions.length;
  merged.intentions = [...board.intentions, ...newIntentions].sort(
    (a, b) => b.at - a.at
  );

  // Principles match on name: the builtins are seeded on every device, so
  // matching on id would duplicate all fifteen of them on restore.
  const havePrinciples = new Set(board.principles.map((p) => p.name));
  const newPrinciples = incoming.principles.filter(
    (p) => p?.name && !havePrinciples.has(p.name)
  );
  counts.principles = newPrinciples.length;
  merged.principles = [...board.principles, ...newPrinciples];

  // Ledger entries are immutable and id-unique, so a restore is add-only.
  // Mark only entries introduced here: restoring the same backup must not
  // relabel captures that were already made in this browser.
  const haveLedger = new Set((board.ledger ?? []).map((e) => e.id));
  const restoredLedger = (incoming.ledger ?? [])
    .filter((e) => !haveLedger.has(e.id))
    .map((e) => ({ ...e, restored: true }));
  merged.ledger = mergeLedgers(board.ledger ?? [], restoredLedger);
  // Same for corrections: a restore never rewrites what this device learned.
  merged.corrections = mergeCorrections(
    board.corrections ?? [],
    incoming.corrections ?? []
  );
  /* The rest of the history travels the same way. This is the third place
     that has to name every Board field by hand — hydrate and the sync merge
     are the others — and the one most easily forgotten, because a restore is
     rare and its loss is silent: the wraps and the ticks simply are not
     there afterwards, with nothing to say they ever were. */
  merged.wraps = mergeWraps(board.wraps ?? [], incoming.wraps ?? []);
  merged.completions = mergeCompletions(
    board.completions ?? [],
    incoming.completions ?? []
  );
  /* The epoch takes the later of the two, so a restore cannot make this
     device look older than it is and lose its history at the next sync.

     Unlike a sync, the history riding in on an older epoch is kept. A sync
     drops it because nobody asked for it — it is another device catching up
     with a wipe. A restore is the opposite: the person went and found this
     file and chose to bring it back, and silently discarding what is in it
     because of a wipe they may well be undoing would be the wrong reading
     of the request. */
  merged.historyEpoch = Math.max(
    board.historyEpoch ?? 0,
    incoming.historyEpoch ?? 0
  );

  return { board: merged, ...counts, images };
}
