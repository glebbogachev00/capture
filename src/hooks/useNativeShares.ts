"use client";

import { useEffect, useRef } from "react";
import { callShell, inNativeShell, SHELL_ACTIVE_EVENT } from "@/lib/nativeShell";

type Shared = { id: string; text: string };
type Submit = (dictated: boolean, pinned: undefined, override: string) => Promise<unknown>;

/**
 * Text and links shared to Capture from other apps (the iPhone app's share
 * sheet) wait in the app until Capture is open, then land here as ordinary
 * captures, one at a time. A share is cleared only after submit saved it, and
 * only while the composer is empty: submit takes the composer's draft and
 * photos along with whatever text it is given.
 */
export function useNativeShares(submit: Submit, composerEmpty: boolean) {
  const submitRef = useRef(submit);
  const emptyRef = useRef(composerEmpty);
  useEffect(() => {
    submitRef.current = submit;
    emptyRef.current = composerEmpty;
  });
  const draining = useRef(false);

  useEffect(() => {
    if (!composerEmpty || !inNativeShell()) return;
    const drain = async () => {
      if (draining.current) return;
      draining.current = true;
      try {
        const { items } = await callShell<{ items: Shared[] }>("peekShares");
        for (const item of items) {
          if (!emptyRef.current) break;
          if ((await submitRef.current(false, undefined, item.text)) === false) break;
          await callShell("clearShare", { id: item.id });
        }
      } catch {
        /* the bridge or a save failed; the shares stay queued for next time */
      } finally {
        draining.current = false;
      }
    };
    void drain();
    window.addEventListener(SHELL_ACTIVE_EVENT, drain);
    return () => window.removeEventListener(SHELL_ACTIVE_EVENT, drain);
  }, [composerEmpty]);
}
