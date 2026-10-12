"use client";

/**
 * Tidy reviews a compact snapshot of the board in one model request.
 *
 * The request checks for duplicate notes, misplaced notes, and notes that may
 * be tasks. It can also propose resolved labels and notes that belong together.
 * The client does not receive step progress, so the waiting copy does not claim
 * that a specific pass has finished.
 */

import { t } from "@/lib/i18n";
import { useEffect, useState } from "react";

/* Roughly one per pass, but written so that arriving early or late at any
   of them is still honest — none of them claims a step has completed. */
/* A function, so the lines are in the reader's language when shown. */
const lines = () => [
  t("Reading the board."),
  t("Going thread by thread — it reads a few at a time, so it can read them properly."),
  t("Looking for things sitting in the wrong place."),
  t("Checking whether anything is here twice."),
  t("Still going. This is the slow, careful pass, not the quick one."),
  t("Nearly there."),
];

/** Long enough that the lines do not race the passes they describe. */
const EVERY_MS = 16_000;

export function TidyWaiting() {
  const [i, setI] = useState(0);

  useEffect(() => {
    const t = setInterval(
      () => setI((n) => Math.min(n + 1, lines().length - 1)),
      EVERY_MS
    );
    return () => clearInterval(t);
  }, []);

  return (
    <div className="tidy-waiting">
      <div className="tidy-waiting-mark" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <p className="tidy-waiting-line">{lines()[i]}</p>
      {/* Said once, near the start, because the honest explanation for the
          wait is also the reassuring one. */}
      {i < 3 && (
        <p className="tidy-waiting-why">
          {t("Tidy is checking the board for duplicate notes, misplaced notes, and notes that may be tasks.")}
        </p>
      )}
    </div>
  );
}
