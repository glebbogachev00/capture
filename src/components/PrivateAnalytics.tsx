"use client";

import { Analytics } from "@vercel/analytics/next";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import {
  redactBrowserUrl,
  sanitizeAnalyticsEvent,
  snapshotCheckoutReturnState,
} from "@/lib/urlPrivacy";

/**
 * Delay Analytics until browser-visible sensitive state has been removed. The
 * middleware remains a second boundary for client navigations and malformed
 * provider return URLs.
 */
function PrivateAnalyticsInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const privateState = snapshotCheckoutReturnState(window.location.href, window.history.state);
    const redacted = redactBrowserUrl(window.location.href);
    if (redacted) window.history.replaceState(privateState, "", redacted);
    let active = true;
    queueMicrotask(() => {
      if (active) setReady(true);
    });
    return () => {
      active = false;
    };
  }, [pathname, searchParams]);

  return ready ? <Analytics beforeSend={sanitizeAnalyticsEvent} /> : null;
}

export function PrivateAnalytics() {
  return (
    <Suspense fallback={null}>
      <PrivateAnalyticsInner />
    </Suspense>
  );
}
