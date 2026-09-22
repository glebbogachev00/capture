"use client";

import { getDocumentLifetime, ownedFetch as fetch } from "@/lib/ownership";
import { useEffect, useState, useSyncExternalStore } from "react";
import {
  cacheCloudEntitlement,
  clearCloudEntitlement,
  cloudEntitlementExpiresAt,
  hasCloudEntitlement,
} from "@/lib/cloudEntitlement";
import {
  captureLimitFromSubscriptionResponse,
  PLAYGROUND,
  TRIAL_LIMIT,
} from "@/lib/playground";

/** Local installs are unlimited; Cloud enforcement waits fail-closed for billing. */
export function useCaptureLimit(): { applies: boolean; ready: boolean } {
  const lifetime = getDocumentLifetime();
  const lifetimeState = useSyncExternalStore(
    lifetime.subscribe,
    lifetime.snapshot,
    lifetime.snapshot,
  );
  const selfHosted = !lifetime.cloud && !PLAYGROUND;
  const [entitlementNow, setEntitlementNow] = useState(() => Date.now());
  const [verifiedExpiresAt, setVerifiedExpiresAt] = useState<number | null>(null);
  const [verificationRevision, setVerificationRevision] = useState(0);
  const offlineExpiresAt = lifetimeState === "offline" && lifetime.owner
    ? cloudEntitlementExpiresAt(lifetime.owner)
    : null;
  const offlinePaid = offlineExpiresAt !== null && offlineExpiresAt > entitlementNow;
  const [captureLimit, setCaptureLimit] = useState<number | null>(
    selfHosted || offlinePaid ? null : TRIAL_LIMIT,
  );
  const [ready, setReady] = useState(
    selfHosted || PLAYGROUND || offlinePaid ||
      (lifetime.cloud && lifetime.owner === null),
  );

  useEffect(() => {
    if (!lifetime.owner) return;
    const refresh = () => setEntitlementNow(Date.now());
    window.addEventListener("storage", refresh);
    const expiresAt = lifetimeState === "offline" ? offlineExpiresAt : verifiedExpiresAt;
    const remaining = expiresAt === null ? null : expiresAt - Date.now();
    const expire = () => {
      clearCloudEntitlement(lifetime.owner!);
      setEntitlementNow(Date.now());
      setCaptureLimit(TRIAL_LIMIT);
      if (lifetime.snapshot() === "active") {
        setReady(false);
        setVerificationRevision((value) => value + 1);
      } else {
        setReady(true);
      }
    };
    const timer = remaining === null || remaining <= 0 ? null : window.setTimeout(
      () => {
        /* Browsers clamp delays to a signed 32-bit integer. Reaching that
           checkpoint is not expiry: refresh the clock so this effect arms the
           remaining span, and expire only at the actual server boundary. */
        if (expiresAt !== null && Date.now() <= expiresAt) {
          setEntitlementNow(Date.now());
          return;
        }
        expire();
      },
      Math.min(remaining + 1, 2_147_483_647),
    );
    return () => {
      window.removeEventListener("storage", refresh);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [lifetime, lifetime.owner, lifetimeState, offlineExpiresAt, verifiedExpiresAt, entitlementNow]);

  useEffect(() => {
    if (selfHosted || PLAYGROUND || (lifetime.cloud && lifetime.owner === null)) return;
    if (lifetimeState !== "active") return;
    let stopped = false;
    // The external lifetime changed; retire any offline-derived display state
    // before accepting a fresh server result without cascading this render.
    queueMicrotask(() => {
      if (stopped) return;
      setCaptureLimit(TRIAL_LIMIT);
      setReady(false);
    });
    void fetch("/api/cloud/subscription", {
      cache: "no-store",
      credentials: "same-origin",
    })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!stopped) {
          // This is already a verified Cloud document; even a 404 must not
          // reclassify it as self-hosted or grant an unlimited allowance.
          const value = body && typeof body === "object"
            ? body as { tier?: unknown; captureLimit?: unknown; accessExpiresAt?: unknown }
            : null;
          const accessExpiresAt = typeof value?.accessExpiresAt === "string"
            ? Date.parse(value.accessExpiresAt)
            : NaN;
          const verifiedPaid = response.ok && value?.tier === "cloud" &&
            value.captureLimit === null && Number.isFinite(accessExpiresAt) &&
            accessExpiresAt > Date.now();
          /* A successful response is authoritative online. Subscription-disabled
             Cloud intentionally returns free/null; it is unlimited while verified
             online, but unlike paid access it is never cached for offline use. */
          const limit = response.ok
            ? captureLimitFromSubscriptionResponse(response.status, body)
            : TRIAL_LIMIT;
          setCaptureLimit(limit);
          if (response.ok && lifetime.owner) {
            if (verifiedPaid) {
              cacheCloudEntitlement(lifetime.owner, accessExpiresAt);
              setVerifiedExpiresAt(accessExpiresAt);
              setEntitlementNow(Date.now());
            } else {
              clearCloudEntitlement(lifetime.owner);
              setVerifiedExpiresAt(null);
            }
          }
          setReady(true);
        }
      })
      .catch(() => {
        if (!stopped) {
          setCaptureLimit(
            lifetime.snapshot() === "offline" && lifetime.owner &&
              hasCloudEntitlement(lifetime.owner)
              ? null
              : TRIAL_LIMIT,
          );
          setReady(true);
        }
      });
    return () => {
      stopped = true;
    };
  }, [lifetime, lifetimeState, selfHosted, verificationRevision]);

  if (lifetimeState === "offline") {
    return {
      applies: !offlinePaid,
      ready: true,
    };
  }
  if (lifetimeState === "revoked") return { applies: true, ready: true };
  return { applies: PLAYGROUND || captureLimit === TRIAL_LIMIT, ready };
}
