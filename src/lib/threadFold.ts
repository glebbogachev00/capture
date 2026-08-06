import type { Board, FoldedThread, Frag, Thread } from "./model";

const byDate = (a: Frag, b: Frag) => a.at - b.at;

/** Fold records are event-like state: keep the newest fold and restore times. */
export function mergeFoldedSources(
  a: FoldedThread[] = [],
  b: FoldedThread[] = []
): FoldedThread[] {
  const byId = new Map<string, FoldedThread>();
  for (const source of [...a, ...b]) {
    const current = byId.get(source.id);
    if (!current) {
      byId.set(source.id, source);
      continue;
    }
    const newer = source.foldedAt > current.foldedAt ? source : current;
    const restoredAt = Math.max(
      current.restoredAt ?? 0,
      source.restoredAt ?? 0
    );
    byId.set(source.id, {
      ...newer,
      foldedFrom: mergeFoldedSources(
        current.foldedFrom,
        source.foldedFrom
      ),
      ...(restoredAt ? { restoredAt } : {}),
    });
  }
  return [...byId.values()].sort(
    (x, y) => x.foldedAt - y.foldedAt || x.id.localeCompare(y.id)
  );
}

/** Sources whose latest fold happened after their latest restore. */
export function activeFoldedSources(thread: Pick<Thread, "foldedFrom">) {
  return (thread.foldedFrom ?? []).filter(
    (source) => source.foldedAt > (source.restoredAt ?? 0)
  );
}

function sourceSnapshot(source: Thread, foldedAt: number): FoldedThread {
  const snapshot: FoldedThread = {
    id: source.id,
    name: source.name,
    summary: source.summary,
    frags: source.frags,
    foldedAt,
  };
  if (source.foldedFrom?.length) snapshot.foldedFrom = source.foldedFrom;
  if (source.updatedAt !== undefined) snapshot.updatedAt = source.updatedAt;
  return snapshot;
}

/**
 * Fold one active thread into another without throwing its identity away.
 *
 * Fragment ids stay canonical: if corrupt or concurrently merged state has
 * the same id in both threads, the source copy wins once and is never
 * duplicated. The destination holds a full source snapshot for restoration.
 */
export function foldThread(
  board: Board,
  intoId: string,
  fromId: string,
  foldedAt: number
): Board {
  if (intoId === fromId) return board;
  const into = board.threads.find((t) => t.id === intoId);
  const from = board.threads.find((t) => t.id === fromId);
  if (!into || !from) return board;

  const frags = new Map(into.frags.map((f) => [f.id, f]));
  for (const f of from.frags) frags.set(f.id, f);
  const foldedFrom = mergeFoldedSources(into.foldedFrom, [
    sourceSnapshot(from, foldedAt),
  ]);

  return {
    ...board,
    threads: board.threads
      .filter((t) => t.id !== fromId)
      .map((t) =>
        t.id === intoId
          ? { ...t, frags: [...frags.values()].sort(byDate), foldedFrom }
          : t
      ),
  };
}

/**
 * Reverse one direct fold. Current fragment text wins over the snapshot, so
 * an edit made while the source lived inside the destination is preserved.
 * Fresh timestamps let the restored thread outrank the old sync tombstones.
 */
export function restoreFoldedThread(
  board: Board,
  intoId: string,
  sourceId: string,
  restoredAt: number
): Board {
  if (board.threads.some((t) => t.id === sourceId)) return board;
  const into = board.threads.find((t) => t.id === intoId);
  const source = into
    ? activeFoldedSources(into).find((t) => t.id === sourceId)
    : undefined;
  if (!into || !source) return board;

  const sourceIds = new Set(source.frags.map((f) => f.id));
  const current = new Map(into.frags.map((f) => [f.id, f]));
  const restoredFrags = source.frags
    .map((f) => ({ ...(current.get(f.id) ?? f), updatedAt: restoredAt }))
    .sort(byDate);
  const restored: Thread = {
    id: source.id,
    name: source.name,
    /* Both summaries are rebuilt from their new fragment sets. Empty is
       honest if the provider is unavailable; the retained snapshot still
       holds the pre-fold source summary. */
    summary: "",
    frags: restoredFrags,
    updatedAt: restoredAt,
  };
  if (source.foldedFrom?.length) restored.foldedFrom = source.foldedFrom;

  return {
    ...board,
    threads: board.threads.flatMap((t) => {
      if (t.id !== intoId) return [t];
      const destination: Thread = {
        ...t,
        summary: "",
        frags: t.frags.filter((f) => !sourceIds.has(f.id)),
        foldedFrom: (t.foldedFrom ?? []).map((f) =>
          f.id === sourceId ? { ...f, restoredAt } : f
        ),
      };
      return [destination, restored];
    }),
  };
}
