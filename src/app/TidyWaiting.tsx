"use client";

/**
 * The minute Tidy now takes.
 *
 * The review used to answer in seconds, and it was worthless: a board of
 * any size renders to more tokens than the fast provider accepts in a
 * minute, so it was rejected every time and the weakest model in the chain
 * answered instead. It now reads the board in paced passes, on the good
 * model, and that takes about a minute and a half.
 *
 * A minute and a half of "Reading the board…" reads as broken. So this says
 * what is actually happening and why it is worth waiting for — the lines
 * are true, in order, and paced to the passes. Nothing here is a fake
 * progress bar: it never claims to know how far along it is, because the
 * request gives no way to know.
 */

import { useEffect, useState } from "react";

/* Roughly one per pass, but written so that arriving early or late at any
   of them is still honest — none of them claims a step has completed. */
const LINES = [
  "Reading the board.",
  "Going thread by thread — it reads a few at a time, so it can read them properly.",
  "Looking for things sitting in the wrong place.",
  "Checking whether anything is here twice.",
  "Still going. This is the slow, careful pass, not the quick one.",
  "Nearly there.",
];

/** Long enough that the lines do not race the passes they describe. */
const EVERY_MS = 16_000;

export function TidyWaiting() {
  const [i, setI] = useState(0);

  useEffect(() => {
    const t = setInterval(
      () => setI((n) => Math.min(n + 1, LINES.length - 1)),
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
      <p className="tidy-waiting-line">{LINES[i]}</p>
      {/* Said once, near the start, because the honest explanation for the
          wait is also the reassuring one. */}
      {i < 3 && (
        <p className="tidy-waiting-why">
          It used to answer in seconds and get it wrong.
        </p>
      )}
    </div>
  );
}
