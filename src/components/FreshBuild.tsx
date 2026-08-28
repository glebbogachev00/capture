"use client";

import { useEffect } from "react";

import { decide } from "@/lib/freshBuild";

/**
 * Notice when the server has moved on, and quietly catch up.
 *
 * The board is kept open for days — installed to a home screen, resumed,
 * backgrounded, resumed again, never actually navigated. Its JavaScript is
 * whatever loaded the first time. The service worker keeps assets fresh and
 * serves documents network-first, but none of that matters to a page that
 * never asks for a document again.
 *
 * The cost of that is not slow updates; it is untrustworthy bug reports. An
 * evening was spent chasing a failure that had been fixed that morning,
 * because the phone reporting it was running the previous day's build and
 * nothing in the app could say so.
 *
 * Two rules shape this, both from the same principle — the friction is
 * ours, not theirs:
 *
 *   It never asks. No banner, no "a new version is available", no button.
 *   Being told to reload is being handed our problem. The check happens when
 *   the app is brought back to the front, which is both the moment a stale
 *   session is most likely and the moment nothing is in progress.
 *
 *   It never interrupts. If there is text in the composer it waits for the
 *   next time — a reload that eats a half-typed thought is far worse than
 *   running yesterday's build a little longer.
 *
 * And it refuses to reload twice for the same answer, so a build id that
 * somehow disagrees with itself costs one reload rather than a loop.
 */

/** At most one check a minute, however often the app is brought forward. */
const EVERY_MS = 60_000;

/** The build this bundle was compiled as. */
const MINE = process.env.NEXT_PUBLIC_BUILD_ID;

/** Remembers the build we have already reloaded for, so we never loop. */
const RELOADED_KEY = "capture:reloaded-for";

export function FreshBuild() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!MINE) return;

    let last = 0;
    let stopped = false;

    const composerBusy = () =>
      Array.from(document.querySelectorAll("textarea")).some(
        (el) => el.value.trim().length > 0
      );

    const check = async () => {
      if (stopped || document.visibilityState !== "visible") return;
      if (Date.now() - last < EVERY_MS) return;
      last = Date.now();

      let served: string | undefined;
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (!res.ok) return; // logged out, offline, mid-deploy: not our business
        served = (await res.json())?.build;
      } catch {
        return;
      }
      if (stopped) return;

      let reloadedFor: string | null = null;
      try {
        reloadedFor = sessionStorage.getItem(RELOADED_KEY);
      } catch {
        /* private mode: the once-a-minute throttle is the only guard left */
      }

      const verdict = decide({
        mine: MINE,
        served,
        visible: document.visibilityState === "visible",
        composerBusy: composerBusy(),
        reloadedFor,
      });
      if (!verdict.reload) return;

      try {
        sessionStorage.setItem(RELOADED_KEY, verdict.remember);
      } catch {
        /* as above */
      }
      location.reload();
    };

    const onVisible = () => void check();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    void check();

    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, []);

  return null;
}
