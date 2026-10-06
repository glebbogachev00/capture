"use client";

import { useSyncExternalStore } from "react";
import { callShell, inNativeShell } from "@/lib/nativeShell";

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
