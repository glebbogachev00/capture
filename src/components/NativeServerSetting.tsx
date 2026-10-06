"use client";

import { useSyncExternalStore } from "react";
import { carryBoardTo } from "@/hooks/useNativeShell";
import { cloudPricingHandoff } from "@/lib/cloudCheckoutClient";
import { callShell, inNativeShell } from "@/lib/nativeShell";
import { PLAYGROUND } from "@/lib/playground";

const noSubscribe = () => () => undefined;

/** Inside the iPhone app only: which Capture this phone opens, and a way to
 * point it at your own (your Mac over Tailscale) or back. */
export function NativeServerSetting() {
  const native = useSyncExternalStore(noSubscribe, inNativeShell, () => false);
  if (!native) return null;
  return (
    <div className="settings-group">
      <h4 className="settings-group-title">Server</h4>
      <p className="settings-copy">
        This phone opens Capture from {window.location.host}. It can open your
        own instead, such as your Mac over Tailscale.
      </p>
      <button className="ghost" onClick={() => void callShell("chooseServer").catch(() => {})}>
        Use another server
      </button>
    </div>
  );
}

/** Inside the iPhone app's free version only: the way to Cloud from Settings,
 * carrying this phone's board along (useNativeShell.ts). */
export function NativeCloudSetting() {
  const native = useSyncExternalStore(noSubscribe, inNativeShell, () => false);
  const cloud = cloudPricingHandoff();
  if (!native || !PLAYGROUND || !cloud) return null;
  return (
    <div className="settings-group">
      <p className="settings-copy">
        Your board is on this phone. Capture Cloud keeps it on all your devices,
        and brings this board along.
      </p>
      <button className="capture-btn" onClick={() => void carryBoardTo(cloud)}>
        Get Capture Cloud
      </button>
    </div>
  );
}
