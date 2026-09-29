import { useEffect } from "react";
import type { Board } from "@/lib/model";
import type { PendingRecoverySnapshot } from "@/lib/pendingRecovery";
import {
  PendingRecoveryOrchestrator,
  type PendingRecoveryAccess,
} from "@/lib/pendingRecoveryOrchestrator";

export function usePendingRecoveryWake(options: {
  loaded: boolean;
  board: Board;
  orchestrator: PendingRecoveryOrchestrator;
  access: () => PendingRecoveryAccess;
  run: (snapshot: PendingRecoverySnapshot) => Promise<void>;
  now: () => number;
}) {
  useEffect(() => {
    if (!options.loaded) return;
    const wake = () => void options.orchestrator.wake({
      ...options.access(), now: options.now,
      online: () => typeof navigator === "undefined" || navigator.onLine,
      run: options.run,
    });
    wake();
    window.addEventListener("online", wake);
    return () => window.removeEventListener("online", wake);
    // Edge-triggered only: never turn Board renders into a retry queue.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.loaded]);

  useEffect(() => {
    if (options.loaded) void options.orchestrator.prune(options.access());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.board, options.loaded]);
}