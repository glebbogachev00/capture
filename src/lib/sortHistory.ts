import type { Board } from "./model";
import { primaryLedgerEntries, type CaptureEntry } from "./ledger";
import { settledLedgerEntries } from "./unsortedOps";

export type RecentSortEntry = {
  raw: string;
  kind: CaptureEntry["kind"];
  at: number;
  target: string;
};

/** Capture-level history for semantic context. Split destinations never become
 * extra recent captures, and the explicit primary row owns series continuity. */
export function sortHistoryContext(board: Board, max = 30): {
  entries: CaptureEntry[];
  previousThread: CaptureEntry | undefined;
  recent: RecentSortEntry[];
} {
  const entries = primaryLedgerEntries(
    settledLedgerEntries(board).filter((entry) => !entry.undone),
  );
  const threadNames = new Map(board.threads.map((thread) => [thread.id, thread.name]));
  const previousThread = entries.find((entry) =>
    (entry.kind === "thread" || entry.kind === "both") && threadNames.has(entry.targetId),
  );
  return {
    entries,
    previousThread,
    recent: entries.slice(0, max).map((entry) => ({
      raw: entry.raw.length > 120 ? entry.raw.slice(0, 120) : entry.raw,
      kind: entry.kind,
      at: entry.at,
      target: entry.kind === "thread" || entry.kind === "both"
        ? (threadNames.get(entry.targetId) ?? "")
        : "",
    })),
  };
}
