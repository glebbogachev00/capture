"use client";

import { getDocumentLifetime, ownedFetch as fetch } from "@/lib/ownership";
import { useEffect, useState } from "react";
import {
  captureLimitFromSubscriptionResponse,
  PLAYGROUND,
  TRIAL_LIMIT,
} from "@/lib/playground";

/** Local installs are unlimited; Cloud enforcement waits fail-closed for billing. */
export function useCaptureLimit(): { applies: boolean; ready: boolean } {
  const lifetime = getDocumentLifetime();
  const selfHosted = !lifetime.cloud && !PLAYGROUND;
  const [captureLimit, setCaptureLimit] = useState<number | null>(
    selfHosted ? null : TRIAL_LIMIT,
  );
  const [ready, setReady] = useState(
    selfHosted || PLAYGROUND || (lifetime.cloud && lifetime.owner === null),
  );

  useEffect(() => {
    if (selfHosted || PLAYGROUND || (lifetime.cloud && lifetime.owner === null)) return;
    let stopped = false;
    void fetch("/api/cloud/subscription", {
      cache: "no-store",
      credentials: "same-origin",
    })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!stopped) {
          // This is already a verified Cloud document; even a 404 must not
          // reclassify it as self-hosted or grant an unlimited allowance.
          setCaptureLimit(response.ok
            ? captureLimitFromSubscriptionResponse(response.status, body)
            : TRIAL_LIMIT);
          setReady(true);
        }
      })
      .catch(() => {
        if (!stopped) {
          setCaptureLimit(TRIAL_LIMIT);
          setReady(true);
        }
      });
    return () => {
      stopped = true;
    };
  }, [lifetime, selfHosted]);

  return { applies: PLAYGROUND || captureLimit === TRIAL_LIMIT, ready };
}
