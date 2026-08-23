"use client";

import { useSyncExternalStore } from "react";
import { QUICKSTART_URL } from "@/lib/playground";

/**
 * One line at the top of the board, on the public instance only.
 *
 * It says the one thing a visitor needs to know and would not guess: this
 * board lives in this browser and nowhere else. No signup prompt, no email
 * box, no logo — the brief's "do not build" list is right, and the empty
 * state underneath is already doing the teaching.
 *
 * Dismissed once, stays dismissed. localStorage rather than the board, so
 * it never syncs (nothing does here) and never exports. Read through
 * useSyncExternalStore: the server snapshot says "dismissed", so SSR renders
 * nothing and the client fills it in after hydration without a mismatch.
 */
const KEY = "capture:playground-notice:v1";
const EVENT = "capture:playground-notice";

const subscribe = (cb: () => void) => {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
};
const read = () => {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
};
const readOnServer = () => true;

export function PlaygroundNotice() {
  const dismissed = useSyncExternalStore(subscribe, read, readOnServer);
  if (dismissed) return null;
  return (
    <p className="playground-note">
      <span>
        This is a playground — your board lives in this browser only.{" "}
        <a href={QUICKSTART_URL} target="_blank" rel="noreferrer">
          Run Capture yourself
        </a>{" "}
        to keep it.
      </span>
      <button
        aria-label="Dismiss"
        onClick={() => {
          try {
            localStorage.setItem(KEY, "1");
          } catch {
            /* private mode — it just shows again next time */
          }
          window.dispatchEvent(new Event(EVENT));
        }}
      >
        ×
      </button>
    </p>
  );
}
