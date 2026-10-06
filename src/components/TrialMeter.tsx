"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { cloudPricingHandoff } from "@/lib/cloudCheckoutClient";
import { inNativeShell } from "@/lib/nativeShell";
import { TRIAL_LIMIT, type TrialState } from "@/lib/playground";

const noSubscribe = () => () => undefined;

export function TrialMeter({
  trial,
  showCloudUpgrade = false,
}: {
  trial: TrialState;
  showCloudUpgrade?: boolean;
}) {
  const used = TRIAL_LIMIT - trial.remaining;
  /* In the iPhone app the moment the day's captures run out is where Cloud
     is offered; installing your own Capture means nothing on a phone. */
  const phone = useSyncExternalStore(noSubscribe, inNativeShell, () => false);
  const cloud = phone ? cloudPricingHandoff() : null;
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
      {showCloudUpgrade && (
        <span className="trial-meter-next">
          <Link href="/pricing">See Capture Cloud</Link>
        </span>
      )}
      {trial.exhausted && (
        <span className="trial-meter-next">
          Resets tomorrow
          {phone
            ? cloud && <> · <a href={cloud}>Get Capture Cloud</a></>
            : <> · <Link href="/install">Install your own</Link></>}
        </span>
      )}
    </div>
  );
}
