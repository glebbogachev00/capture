import type { Board } from "./model";

/** Explicit additions have their own identity, never the source board's reset
 * authority. Pending history can wait locally for paid Cloud indefinitely.
 * Only the server's atomic board write acknowledges it. */
export function markHistoryImport(source: Board, destination: Board | null, batch: string): Board {
  const wraps = source.wraps?.map((wrap, i) => ({ ...wrap, importBatch: `${batch}-${i}` }));
  return {
    ...source,
    historyEpoch: destination?.historyEpoch ?? 0,
    historyImports: {
      [batch]: "pending",
      ...Object.fromEntries((wraps ?? []).map(w => [w.importBatch, "pending" as const])),
      ...destination?.historyImports,
    },
    ledger: source.ledger?.map(entry => ({ ...entry, importBatch: batch, restored: true })),
    corrections: source.corrections?.map(entry => ({ ...entry, importBatch: batch })),
    completions: source.completions?.map(entry => ({ ...entry, importBatch: batch })),
    wraps,
  };
}
