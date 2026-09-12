"use client";

import { useEffect, useState } from "react";
import {
  captureLimitFromSubscriptionResponse,
  PLAYGROUND,
  TRIAL_LIMIT,
} from "@/lib/playground";

/** Whether this browser should use Capture's fifteen-a-day public allowance. */
export function useCaptureLimit(): boolean {
  const [captureLimit, setCaptureLimit] = useState<number | null>(TRIAL_LIMIT);

  useEffect(() => {
    if (PLAYGROUND) return;
    let stopped = false;
    void fetch("/api/cloud/subscription", {
      cache: "no-store",
      credentials: "same-origin",
    })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!stopped) {
          setCaptureLimit(captureLimitFromSubscriptionResponse(response.status, body));
        }
      })
      .catch(() => {
        if (!stopped) setCaptureLimit(TRIAL_LIMIT);
      });
    return () => {
      stopped = true;
    };
  }, []);

  return PLAYGROUND || captureLimit === TRIAL_LIMIT;
}
