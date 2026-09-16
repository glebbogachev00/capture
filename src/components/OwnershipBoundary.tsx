"use client";

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { LegacyImportGate } from "./LegacyImport";
import { OwnershipFallback } from "./OwnershipFallback";
import styles from "./OwnershipBoundary.module.css";
import { flushSync } from "react-dom";
import { installDocumentLifetime, openCloudIdentity, verifyCloudIdentity, isAuthTransition, logoutSnapshot, subscribeLogout, logoutAndNavigate, type OwnershipLifetime } from "@/lib/ownership";

/** No board hooks, image caches or storage effects exist before verification. */
export function OwnershipBoundary({ cloud, children }: { cloud: boolean; children: ReactNode }) {
  const [lifetime, setLifetime] = useState<OwnershipLifetime | null>(null);
  const [error, setError] = useState("");
  const logoutStatus = useSyncExternalStore(subscribeLogout, logoutSnapshot, () => "" as const);
  useEffect(() => {
    let cancelled = false;
    let granted: OwnershipLifetime | undefined;
    const transition = (event: StorageEvent) => {
      if (!cloud || !isAuthTransition(event)) return;
      cancelled = true;
      granted?.revoke();
      setError("Your account changed during verification. Reload to verify it again.");
    };
    window.addEventListener("storage", transition);
    void (async () => {
      try {
        const identity = cloud ? await openCloudIdentity() : undefined;
        if (!cancelled) { granted = installDocumentLifetime(identity); setLifetime(granted); }
      } catch {
        if (!cancelled) setError("Your account could not be verified. Your device data has not been changed.");
      }
    })();
    return () => { cancelled = true; window.removeEventListener("storage", transition); };
  }, [cloud]);
  if (logoutStatus) return <OwnershipFallback
    checking={logoutStatus === "working"}
    title={logoutStatus === "working" ? "Closing your session" : "Logout needs another try"}
    message={logoutStatus === "working" ? "Logging out… Your board is hidden." : "Logout has not completed. Your board is hidden and your device data has not been changed."}
  >
    <button disabled={logoutStatus === "working"} onClick={() => { void logoutAndNavigate(); }}>Retry logout</button>
    <a href="/login">Sign in again</a>
  </OwnershipFallback>;
  if (!lifetime) return <OwnershipFallback
    checking={!error}
    title={error ? "Let’s verify your account" : "Opening Capture"}
    message={error || "Verifying this device’s account…"}
  >{error && <a href="/app">Reload and verify</a>}</OwnershipFallback>;
  return <VerifiedDocument lifetime={lifetime}>{children}</VerifiedDocument>;
}

function VerifiedDocument({ lifetime, children }: { lifetime: OwnershipLifetime; children: ReactNode }) {
  const status = useSyncExternalStore(lifetime.subscribe, lifetime.snapshot, lifetime.snapshot);
  const visible = status === "active" || status === "offline";
  useEffect(() => {
    // Remove account content synchronously, not after a transition paint.
    const hide = lifetime.subscribe(() => { flushSync(() => {}); });
    const stop = lifetime.watch(verifyCloudIdentity);
    return () => { hide(); stop(); };
  }, [lifetime]);
  return <div className={styles.root}>
    {status === "offline" && <p className={styles.offlineStatus} role="status">Offline on this device. Local changes are not synced. AI is unavailable until your account is verified online.</p>}
    {!visible && <OwnershipFallback
      checking={status !== "revoked"}
      title={status === "revoked" ? "Verify before you continue" : "Checking your account"}
      message={status === "revoked" ? "This account session ended or changed. Reload to verify before opening a board." : "Verifying your account…"}
    ><a href="/app">Reload and verify</a></OwnershipFallback>}
    {status !== "revoked" && <div hidden={!visible} inert={status === "checking"}><LegacyImportGate lifetime={lifetime}>{children}</LegacyImportGate></div>}
  </div>;
}
