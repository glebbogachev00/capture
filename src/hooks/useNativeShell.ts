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

type SaveBackup = (backup: unknown, filename: string) => void;
type Carry = {
  exportBoard: (save?: SaveBackup) => Promise<void>;
  restoreFromFile: (file: File) => Promise<boolean | undefined>;
};
let carry: Carry | null = null;

/**
 * Carrying the free version's board to Cloud (or your own server) in the
 * iPhone app. Each server keeps its own storage, so the free version saves a
 * backup with the app on its way to Cloud, and the next board offers to bring
 * it in (PhoneBoardOffer) through the ordinary restore, which only ever adds.
 * Capture registers its board's backup and restore here.
 */
export function useBoardCarry(exportBoard: Carry["exportBoard"], restoreFromFile: Carry["restoreFromFile"]) {
  useEffect(() => {
    carry = { exportBoard, restoreFromFile };
  });
}

/** Keep this phone's board with the app, then go to `href`. */
export async function carryBoardTo(href: string, go = (url: string) => window.location.assign(url)) {
  let kept: Promise<unknown> = Promise.resolve();
  await carry?.exportBoard((backup) => {
    kept = callShell("stashBoard", { json: JSON.stringify(backup) });
  }).catch(() => {});
  await kept.catch(() => {});
  go(href);
}

/** Restore the kept board into this one; true once it is in. */
export async function bringInKeptBoard(): Promise<boolean> {
  if (!carry) return false;
  const { json } = await callShell<{ json: string }>("takeStashedBoard");
  const done = await carry.restoreFromFile(new File([json], "free-board.json", { type: "application/json" }));
  if (done) await callShell("clearStashedBoard");
  return Boolean(done);
}
