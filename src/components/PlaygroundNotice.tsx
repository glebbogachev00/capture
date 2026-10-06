"use client";

import { useSyncExternalStore } from "react";
import { cloudPricingHandoff } from "@/lib/cloudCheckoutClient";
import { inNativeShell } from "@/lib/nativeShell";
import { QUICKSTART_URL } from "@/lib/playground";

const noSubscribe = () => () => undefined;

/** Persistent, plain-language paths out of the browser-only playground. In
 * the iPhone app the board lives on the phone, and running your own Capture
 * is a Settings choice there, not a link to the install guide. */
export function PlaygroundNotice() {
  const cloudPricing = cloudPricingHandoff();
  const phone = useSyncExternalStore(noSubscribe, inNativeShell, () => false);
  return (
    <aside className="playground-note" aria-labelledby="playground-note-title">
      <div className="playground-note-copy">
        <strong id="playground-note-title">Choose where to keep your board</strong>
        <span>
          {phone ? "Your board stays on this phone." : "This playground stays in this browser."} Use Cloud to sync across devices.
        </span>
      </div>
      <div className="playground-note-actions">
        {cloudPricing && (
          <a className="playground-note-action is-primary" href={cloudPricing}>
            Start with Capture Cloud
          </a>
        )}
        {!phone && (
          <a className="playground-note-action is-secondary" href={QUICKSTART_URL}>
            Try Capture Locally
          </a>
        )}
      </div>
    </aside>
  );
}
