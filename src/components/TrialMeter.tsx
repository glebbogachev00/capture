"use client";

import Link from "next/link";
import { TRIAL_LIMIT, type TrialState } from "@/lib/playground";

export function TrialMeter({ trial }: { trial: TrialState }) {
  const used = TRIAL_LIMIT - trial.remaining;
  return (
    <div
      id="trial-meter-status"
      className={"trial-meter" + (trial.exhausted ? " is-full" : "")}
    >
      <span className="trial-meter-head">
        <span className="trial-meter-label">Daily trial</span>
        <strong>
          {trial.exhausted
            ? "Daily limit reached"
            : `${trial.remaining} ${trial.remaining === 1 ? "capture" : "captures"} left`}
        </strong>
      </span>
      <span
        className="trial-meter-track"
        role="progressbar"
        aria-label={`Daily trial: ${used} of ${TRIAL_LIMIT} used`}
        aria-valuemin={0}
        aria-valuemax={TRIAL_LIMIT}
        aria-valuenow={used}
      >
        {Array.from({ length: TRIAL_LIMIT }, (_, index) => (
          <span
            className={"trial-meter-step" + (index < used ? " is-used" : "")}
            key={index}
            aria-hidden="true"
          />
        ))}
      </span>
      <strong className="trial-meter-count">{used} / {TRIAL_LIMIT} used</strong>
      {trial.exhausted && (
        <span className="trial-meter-next">
          Resets tomorrow · <Link href="/install">Install your own</Link>
        </span>
      )}
    </div>
  );
}
