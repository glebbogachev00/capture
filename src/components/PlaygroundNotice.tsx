"use client";

import { useSyncExternalStore } from "react";
import { cloudPricingHandoff } from "@/lib/cloudCheckoutClient";
import { inNativeShell } from "@/lib/nativeShell";
import { QUICKSTART_URL } from "@/lib/playground";

const noSubscribe = () => () => undefined;

/** Persistent, plain-language paths out of the browser-only playground. The
 * iPhone app shows none of it: there the board simply opens, and Cloud is
 * offered when the day's captures run out (TrialMeter) or in Settings. */
export function PlaygroundNotice() {
  const cloudPricing = cloudPricingHandoff();
  const phone = useSyncExternalStore(noSubscribe, inNativeShell, () => false);
  if (phone) return null;
  return (
    <aside className="playground-note" aria-labelledby="playground-note-title">
      <div className="playground-note-copy">
        <strong id="playground-note-title">Choose where to keep your board</strong>
        <span>
          This playground stays in this browser. Use Cloud to sync across devices.
        </span>
      </div>
      <div className="playground-note-actions">
        {cloudPricing && (
          <a className="playground-note-action is-primary" href={cloudPricing}>
            Start with Capture Cloud
          </a>
        )}
        <a className="playground-note-action is-secondary" href={QUICKSTART_URL}>
          Try Capture Locally
        </a>
      </div>
    </aside>
  );
}
