import { useEffect, useRef } from "react";
import type { Board } from "@/lib/model";
import type { PendingRecoverySnapshot } from "@/lib/pendingRecovery";
import {
  PendingRecoveryOrchestrator,
  type PendingRecoveryAccess,
} from "@/lib/pendingRecoveryOrchestrator";

/* A retry never comes sooner than this, so a capture whose sort is still
   running is looked at again gently rather than every frame. */
const MIN_RETRY_DELAY_MS = 5_000;

const visible = () => typeof document === "undefined" || document.visibilityState === "visible";

export function usePendingRecoveryWake(options: {
  loaded: boolean;
  board: Board;
  orchestrator: PendingRecoveryOrchestrator;
  access: () => PendingRecoveryAccess;
  run: (snapshot: PendingRecoverySnapshot) => Promise<void>;
  now: () => number;
  /** A sort for this capture is still running. */
  busy?: (captureId: string) => boolean;
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const wakeRef = useRef<() => Promise<void>>(async () => {});

  /* One timer, for when the next retry is due, and only while the app is on
     screen. A sort cut off by leaving the app, or one the model could not
     answer, used to wait for the next reload; now it runs when it is due. */
  const arm = () => {
    clearTimeout(timer.current);
    timer.current = undefined;
    if (!options.loaded || !visible()) return;
    const due = options.orchestrator.nextDueAt(options.access().board());
    if (due === null) return;
    timer.current = setTimeout(
      () => void wakeRef.current(),
      Math.max(MIN_RETRY_DELAY_MS, due - options.now()),
    );
  };

  useEffect(() => {
    if (!options.loaded) return;
    const wake = async () => {
      await options.orchestrator.wake({
        ...options.access(), now: options.now,
        online: () => typeof navigator === "undefined" || navigator.onLine,
        run: options.run,
        busy: options.busy,
      });
      arm();
    };
    wakeRef.current = wake;
    /* Coming back to the app is when an interrupted sort should resume. */
    const onShown = () => {
      if (visible()) void wake();
      else clearTimeout(timer.current);
    };
    const onOnline = () => void wake();
    void wake();
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onShown);
    window.addEventListener("pageshow", onShown);
    return () => {
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onShown);
      window.removeEventListener("pageshow", onShown);
      clearTimeout(timer.current);
    };
    // Edge-triggered only: never turn Board renders into a retry queue.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.loaded]);

  useEffect(() => {
    if (!options.loaded) return;
    /* A new pending capture brings a new due time; arming sets a timer, it
       never runs a sort from a render. */
    void options.orchestrator.prune(options.access()).then(arm, arm);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.board, options.loaded]);
}
