"use client";

import { countNoun, t } from "@/lib/i18n";
import Link from "next/link";
import { TRIAL_LIMIT, type TrialState } from "@/lib/playground";

export function TrialMeter({
  trial,
  showCloudUpgrade = false,
}: {
  trial: TrialState;
  showCloudUpgrade?: boolean;
}) {
  const used = TRIAL_LIMIT - trial.remaining;
  return (
    <div
      id="trial-meter-status"
      className={"trial-meter" + (trial.exhausted ? " is-full" : "")}
    >
      <span className="trial-meter-head">
        <span className="trial-meter-label">{t("Daily trial")}</span>
        <strong>
          {trial.exhausted
            ? t("Daily limit reached")
            : t("{count} left", { count: countNoun(trial.remaining, "capture") })}
        </strong>
      </span>
      <span
        className="trial-meter-track"
        role="progressbar"
        aria-label={t("Daily trial: {used} of {limit} used", { used, limit: TRIAL_LIMIT })}
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
      <strong className="trial-meter-count">{t("{used} / {limit} used", { used, limit: TRIAL_LIMIT })}</strong>
      {showCloudUpgrade && (
        <span className="trial-meter-next">
          <Link href="/pricing">{t("See Capture Cloud")}</Link>
        </span>
      )}
      {trial.exhausted && (
        <span className="trial-meter-next">
          {t("Resets tomorrow ·")} <Link href="/install">{t("Install your own")}</Link>
        </span>
      )}
    </div>
  );
}
