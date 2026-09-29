import type { Board } from "./model";
import { deriveCorrectionExamples } from "./correctionExamples";
import { seriesFor } from "./series";
import { threadBriefs } from "./threadBrief";
import { settledLedgerEntries } from "./unsortedOps";

/** Build every Thread-derived field sent to Sort from the same routability
 * boundary. Temporary offline-created Threads stay display-only until rename;
 * their ids, titles, history, continuation hints, and corrections cannot leak
 * into semantic model context through a secondary path. */
export function semanticSortContext(
  board: Board,
  raw: string,
  disabledCorrectionKeys: string[] = [],
  now = Date.now(),
) {
  const threads = threadBriefs(board.threads);
  const names = new Map(threads.map((thread) => [thread.id, thread.name]));
  const isThreadSettlement = (entry: { kind: string }) =>
    entry.kind === "thread" || entry.kind === "both";
  const settled = settledLedgerEntries(board).filter((entry) =>
    !entry.undone &&
    (!isThreadSettlement(entry) || (!!entry.targetId && names.has(entry.targetId)))
  );
  const previous = settled.find((entry) => isThreadSettlement(entry) && entry.targetId);
  const series = previous?.targetId
    ? seriesFor(raw, {
        raw: previous.raw,
        at: previous.at,
        threadId: previous.targetId,
        threadName: names.get(previous.targetId)!,
      }, now)
    : null;
  const recent = settled.slice(0, 30).map((entry) => ({
    raw: entry.raw.length > 120 ? entry.raw.slice(0, 120) : entry.raw,
    kind: entry.kind,
    at: entry.at,
    target: isThreadSettlement(entry) && entry.targetId
      ? names.get(entry.targetId) ?? ""
      : "",
  }));
  const correctionExamples = deriveCorrectionExamples(
    board.corrections ?? [],
    board.threads,
    disabledCorrectionKeys,
  );

  return { threads, recent, series, correctionExamples };
}
