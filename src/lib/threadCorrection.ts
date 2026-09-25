import type { Thread } from "@/lib/model";

/** Undo may remove a newly created wrong Thread before asking where the
 * capture belonged. Count the destinations still on the board, rather than
 * requiring two Threads after that rollback. */
export function hasAlternativeThread(threads: Thread[], wrongThreadId?: string): boolean {
  return threads.some((thread) => thread.id !== wrongThreadId);
}