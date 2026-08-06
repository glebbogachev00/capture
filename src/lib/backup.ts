import { type Board, hydrate } from "./model";
import { mergeCorrections, mergeLedgers } from "./ledger";

/**
 * Getting the whole board out of the device, and back in.
 *
 * Everything lives in one browser's IndexedDB. Clearing site data, replacing
 * the phone, or the OS evicting the PWA all take the lot with them, and until
 * now there was no way to get a copy out. Export is the more important half of
 * this file: import only matters once something has been exported.
 *
 * Images are deliberately not included. They are stored per-id outside the
 * board and would turn a small readable file into megabytes of base64; a
 * restored board simply shows the text without them.
 */

export const BACKUP_APP = "capture";
export const BACKUP_VERSION = 1;

export type CaptureBackup = {
  app: typeof BACKUP_APP;
  version: number;
  exportedAt: string;
  board: Board;
};

export function buildBackup(board: Board): CaptureBackup {
  return {
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    board,
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
  merged.ledger = mergeLedgers(board.ledger ?? [], incoming.ledger ?? []);
  // Same for corrections: a restore never rewrites what this device learned.
  merged.corrections = mergeCorrections(
    board.corrections ?? [],
    incoming.corrections ?? []
  );

  return { board: merged, ...counts };
}
