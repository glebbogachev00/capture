"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { t } from "@/lib/i18n";
import type { Action, Board } from "@/lib/model";
import { exactPendingSnapshot, type PendingRecoverySnapshot } from "@/lib/pendingRecovery";
import { RECHECK_EVERY_MS, Reachability } from "@/lib/reachability";

/** What a capture waiting for the server says, wherever it is shown. The
 * server is named by what it does, not by where it runs: it may be a Mac, a
 * home server or Capture Cloud. */
export const WAITING_TO_SORT = () => t("Saved on this device. It sorts as soon as Capture reconnects.");

/**
 * Captures saved on this device whose sort is waiting for the server (see
 * lib/reachability). They stay visible as Unsorted with that one sentence,
 * nothing to do; while any wait, the server is asked again every few
 * seconds and on return to the app, and the moment it answers they are
 * sorted. Nothing here counts as a failed sort.
 */
export function useWaitingCaptures(options: {
  loaded: boolean;
  /** The board's actions as rendered, to tell which captures still wait. */
  actions: Action[];
  board: () => Board;
  sort: (snapshot: PendingRecoverySnapshot) => Promise<void>;
  request: (input: string, init?: RequestInit) => Promise<Response>;
  /** A capture just started waiting (say so where the person is looking). */
  onHold?: (targetId: string) => void;
}) {
  const reach = useMemo(() => new Reachability(options.request), [options.request]);
  const held = useRef(new Set<string>());
  const [ids, setIds] = useState<string[]>([]);
  const latest = useRef(options);
  useEffect(() => { latest.current = options; });

  /* A capture sorted elsewhere (another device, the hub) is no longer waiting. */
  const pending = new Set(options.actions.filter((action) => action.unsorted).map((action) => action.id));
  const waitingIds = ids.filter((id) => pending.has(id));

  const hold = (targetId: string) => {
    held.current.add(targetId);
    setIds((current) => (current.includes(targetId) ? current : [...current, targetId]));
    latest.current.onHold?.(targetId);
  };

  useEffect(() => {
    if (!options.loaded || !waitingIds.length) return;
    let checking = false;
    const resume = async () => {
      if (checking || document.visibilityState !== "visible") return;
      checking = true;
      try {
        if (!(await reach.check())) return;
        const waiting = [...held.current];
        held.current.clear();
        setIds([]);
        for (const id of waiting) {
          const snapshot = exactPendingSnapshot(latest.current.board(), id);
          if (snapshot) await latest.current.sort(snapshot);
        }
      } finally {
        checking = false;
      }
    };
    /* Ask once at once: "unreachable" may be stale by now. */
    void resume();
    const timer = setInterval(() => void resume(), RECHECK_EVERY_MS);
    window.addEventListener("online", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [options.loaded, waitingIds.length, reach]);

  return {
    waitingIds,
    /** Known unreachable: hold the capture now instead of starting a sort. */
    holdIfDown: (targetId: string) => (reach.isDown() ? (hold(targetId), true) : false),
    /** While a sort runs, hold it and stop it if the server stops answering. */
    watch: (targetId: string, stop: () => void) => reach.watch(() => { hold(targetId); stop(); }),
    /** After a failed sort: held already, or a network error and the server
     * still does not answer (it was off, not slow), so hold it now. */
    heldAfter: async (error: unknown, targetId: string) => {
      if (held.current.has(targetId)) return true;
      if (!(error instanceof TypeError) || (await reach.check())) return false;
      hold(targetId);
      return true;
    },
    receiptFor: (targetId: string, otherwise: string) => (held.current.has(targetId) ? WAITING_TO_SORT() : otherwise),
  };
}
