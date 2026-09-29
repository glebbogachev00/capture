import type { Board } from "./model";

/** Rename one current Thread and retire a mechanical temporary marker. */
export function applyThreadRename(board: Board, id: string, name: string) {
  const target = board.threads.find((thread) => thread.id === id);
  if (!target || !name.trim() || target.name === name) return null;
  return {
    previous: target.name,
    wasTemporary: !!target.temporaryName,
    board: {
      ...board,
      threads: board.threads.map((thread) => {
        if (thread.id !== id) return thread;
        const named = { ...thread };
        delete named.temporaryName;
        return { ...named, name, summary: "", belongs: undefined, next: null };
      }),
    },
  };
}
